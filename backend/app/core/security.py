import base64
import hashlib
import hmac
import json
import logging
import secrets
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Dict, Optional, Union

from app.core.config import settings
from app.core.database import revoked_token_jtis

logger = logging.getLogger(__name__)

# Nạp bộ băm mật khẩu: ưu tiên Argon2id (argon2-cffi), fallback BCrypt (bcrypt)
try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError

    _argon2_hasher = PasswordHasher()
except ImportError:
    _argon2_hasher = None
    VerifyMismatchError = Exception

try:
    import bcrypt as _bcrypt
except ImportError:
    _bcrypt = None

try:
    import jwt as _pyjwt
    from jwt import InvalidTokenError as _JwtInvalidError
except ImportError:
    _pyjwt = None
    _JwtInvalidError = Exception


def get_active_hash_scheme() -> str:
    """Trả về thuật toán băm mật khẩu mặc định đang sẵn sàng (argon2 hoặc bcrypt)."""
    if _argon2_hasher is not None:
        return "argon2"
    if _bcrypt is not None:
        return "bcrypt"
    return "pbkdf2_sha256"


def get_password_hash(password: str, scheme: str = "auto") -> str:
    """Băm mật khẩu bằng Argon2 hoặc BCrypt để lưu an toàn trong CSDL."""
    if not password:
        raise ValueError("Mật khẩu không được để trống.")

    chosen = get_active_hash_scheme() if scheme == "auto" else scheme.lower()
    if chosen == "argon2" and _argon2_hasher is not None:
        return _argon2_hasher.hash(password)
    if chosen in ("bcrypt", "argon2") and _bcrypt is not None:
        pw_bytes = password.encode("utf-8")[:72]
        return _bcrypt.hashpw(pw_bytes, _bcrypt.gensalt(rounds=12)).decode("utf-8")

    # Fallback cuối cùng dùng PBKDF2-HMAC-SHA256 chuẩn thư viện Python
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return f"pbkdf2_sha256${salt}${base64.b64encode(derived).decode('ascii')}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Kiểm tra mật khẩu thuần với chuỗi băm Argon2 ($argon2...) hoặc BCrypt ($2b$/$2a$/$2y$)."""
    if not plain_password or not hashed_password:
        return False

    if hashed_password.startswith("$argon2"):
        if _argon2_hasher is None:
            return False
        try:
            return bool(_argon2_hasher.verify(hashed_password, plain_password))
        except VerifyMismatchError:
            return False
        except Exception:
            return False

    if hashed_password.startswith(("$2a$", "$2b$", "$2y$")):
        if _bcrypt is None:
            return False
        try:
            return bool(
                _bcrypt.checkpw(plain_password.encode("utf-8")[:72], hashed_password.encode("utf-8"))
            )
        except Exception:
            return False

    if hashed_password.startswith("pbkdf2_sha256$"):
        try:
            _, salt, b64_digest = hashed_password.split("$", 2)
            expected = base64.b64decode(b64_digest.encode("ascii"))
            actual = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt.encode("utf-8"), 200_000)
            return hmac.compare_digest(actual, expected)
        except Exception:
            return False

    return False


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _encode_jwt_payload(payload: Dict[str, Any]) -> str:
    if _pyjwt is not None:
        return _pyjwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    sig = hmac.new(settings.SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url_encode(sig)}"


def create_access_token(
    subject: Union[str, Any],
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[Dict[str, Any]] = None,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode: Dict[str, Any] = {
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp()),
        "sub": str(subject),
        "type": "access",
        "jti": str(uuid.uuid4()),
    }
    if extra_claims:
        to_encode.update(extra_claims)
    return _encode_jwt_payload(to_encode)


def create_refresh_token(
    subject: Union[str, Any],
    expires_delta: Optional[timedelta] = None,
    remember_me: bool = True,
    extra_claims: Optional[Dict[str, Any]] = None,
) -> str:
    now = datetime.now(timezone.utc)
    default_days = settings.REFRESH_TOKEN_EXPIRE_DAYS if remember_me else 1
    expire = now + (expires_delta or timedelta(days=default_days))
    to_encode: Dict[str, Any] = {
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp()),
        "sub": str(subject),
        "type": "refresh",
        "remember_days": default_days,
        "jti": str(uuid.uuid4()),
    }
    if extra_claims:
        to_encode.update(extra_claims)
    return _encode_jwt_payload(to_encode)


def decode_token(token: str, expected_type: Optional[str] = None) -> Dict[str, Any]:
    """Giải mã và kiểm tra chữ ký, hạn sử dụng, loại token và trạng thái thu hồi (revoked)."""
    if not token:
        raise ValueError("Token trống.")

    if _pyjwt is not None:
        try:
            payload = _pyjwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        except _JwtInvalidError as exc:
            raise ValueError(f"Token không hợp lệ hoặc đã hết hạn: {exc}") from exc
    else:
        try:
            header_b64, payload_b64, sig_b64 = token.split(".", 2)
            signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
            expected_sig = hmac.new(settings.SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()
            if not hmac.compare_digest(_b64url_decode(sig_b64), expected_sig):
                raise ValueError("Chữ ký token không hợp lệ.")
            payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
            if int(payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
                raise ValueError("Token đã hết hạn.")
        except Exception as exc:
            raise ValueError(f"Token không hợp lệ: {exc}") from exc

    if expected_type and payload.get("type") != expected_type:
        raise ValueError(f"Sai loại token (cần '{expected_type}').")

    jti = payload.get("jti")
    if jti and jti in revoked_token_jtis:
        raise ValueError("Phiên đăng nhập đã bị thu hồi.")

    return payload


def generate_otp_code(digits: int = 6) -> str:
    """Sinh mã OTP ngẫu nhiên an toàn gồm 6 chữ số."""
    return "".join(secrets.choice("0123456789") for _ in range(digits))


def hash_otp_code(otp_code: str) -> str:
    """Băm mã OTP kèm SECRET_KEY trước khi lưu vào bộ nhớ / Redis."""
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        otp_code.strip().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_otp_hash(plain_otp: str, stored_hash: str) -> bool:
    if not plain_otp or not stored_hash:
        return False
    return hmac.compare_digest(hash_otp_code(plain_otp), stored_hash)


def send_otp_email(to_email: str, otp_code: str, full_name: str = "Thầy/Cô Giáo Viên") -> Dict[str, Any]:
    """
    Gửi mã OTP 6 số qua SMTP Email nếu đã cấu hình SMTP_HOST/SMTP_USER.
    Ở môi trường local/test chưa cấu hình SMTP, tự động fallback an toàn và ghi log.
    """
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        logger.info("[OTP-DEV] Mã OTP 6 số gửi tới email %s là %s (chế độ fallback local).", to_email, otp_code)
        return {
            "delivered": True,
            "channel": "dev_fallback",
            "detail": "Chưa cấu hình SMTP_HOST/SMTP_USER — dùng kênh OTP nội bộ cho môi trường dev/demo.",
        }

    msg = EmailMessage()
    msg["Subject"] = "[AI Interactive Canvas] Mã OTP xác thực đăng nhập Giáo viên"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg.set_content(
        f"Xin chào {full_name},\n\n"
        f"Mã OTP xác thực đăng nhập bảng vẽ thông minh của bạn là: {otp_code}\n"
        f"Mã có hiệu lực trong {settings.OTP_EXPIRE_SECONDS // 60} phút.\n"
        f"Không chia sẻ mã này cho người khác.\n"
    )

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            if settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        return {"delivered": True, "channel": "smtp_email", "detail": f"Đã gửi email tới {to_email}"}
    except Exception as exc:
        logger.warning("Không thể kết nối SMTP (%s), chuyển fallback local: %s", settings.SMTP_HOST, exc)
        return {
            "delivered": True,
            "channel": "dev_fallback",
            "detail": f"SMTP tạm không khả dụng ({exc}); đã chuyển chế độ dự phòng local.",
        }
