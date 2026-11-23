import hashlib
import hmac
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Header, HTTPException, Query, Request, status

from app.core.config import settings
from app.core.database import (
    in_memory_login_failures,
    in_memory_otp_cooldowns,
    in_memory_otps,
    in_memory_refresh_sessions,
    in_memory_snapshots,
    in_memory_student_bindings,
    in_memory_users,
    revoked_token_jtis,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_otp_code,
    get_active_hash_scheme,
    get_password_hash,
    hash_otp_code,
    send_otp_email,
    verify_otp_hash,
    verify_password,
)
from app.schemas.auth import (
    ForgotPasswordOTPRequest,
    LogoutRequest,
    RefreshTokenRequest,
    RequestOTPRequest,
    ResetPasswordOTPRequest,
    StudentParentLoginRequest,
    StudentParentRegisterRequest,
    TeacherPasswordLoginRequest,
    TeacherRegisterRequest,
    TokenResponse,
    UserOut,
    VerifyOTPRequest,
)

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["Authentication, 14-Day Session & Student/Parent RBAC (TF28514, TF28515)"],
)

logger = logging.getLogger(__name__)

# Alias tương thích ngược cho các module cũ nếu có import OTP_STORE
OTP_STORE = in_memory_otps

MAX_OTP_ATTEMPTS = 5
AUTH_FAILURE_WINDOW_SECONDS = 900
MAX_LOCKOUT_SECONDS = 900
VALID_SCHOOL_LEVELS = {"TIEU_HOC", "THCS", "THPT"}


def get_client_ip(request: Optional[Request]) -> str:
    if request is not None and getattr(request, "client", None) and request.client.host:
        return request.client.host
    return "unknown"


def _rate_limit_keys(scope: str, identity: str, client_ip: str) -> List[str]:
    norm_id = (identity or "").strip().lower() or "anonymous"
    norm_ip = (client_ip or "unknown").strip().lower()
    return [f"{scope}|id:{norm_id}|ip:{norm_ip}", f"{scope}|id:{norm_id}|ip:*"]


def check_auth_rate_limit(scope: str, identity: str, client_ip: str = "unknown") -> None:
    if not settings.LOGIN_RATE_LIMIT_ENABLED:
        return
    now_ts = time.monotonic()
    for key in _rate_limit_keys(scope, identity, client_ip):
        entry = in_memory_login_failures.get(key)
        if not entry:
            continue
        locked_until = entry.get("locked_until", 0.0)
        if locked_until > now_ts:
            retry_after = max(1, int(locked_until - now_ts + 0.999))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Quá nhiều lần thử xác thực thất bại. Vui lòng thử lại sau {retry_after} giây.",
                headers={"Retry-After": str(retry_after)},
            )


def record_auth_failure(scope: str, identity: str, client_ip: str = "unknown") -> None:
    if not settings.LOGIN_RATE_LIMIT_ENABLED:
        return
    now_ts = time.monotonic()
    max_attempts = max(1, int(settings.LOGIN_MAX_FAILED_ATTEMPTS))
    base_lockout = max(1, int(settings.LOGIN_LOCKOUT_BASE_SECONDS))
    for key in _rate_limit_keys(scope, identity, client_ip):
        entry = in_memory_login_failures.get(key)
        if not entry or (now_ts - entry.get("last_failed_at", now_ts)) > AUTH_FAILURE_WINDOW_SECONDS:
            entry = {"count": 0, "locked_until": 0.0, "last_failed_at": now_ts}
        entry["count"] = entry.get("count", 0) + 1
        entry["last_failed_at"] = now_ts
        if entry["count"] >= max_attempts:
            exponent = min(6, entry["count"] - max_attempts)
            backoff = min(MAX_LOCKOUT_SECONDS, base_lockout * (2 ** exponent))
            entry["locked_until"] = now_ts + backoff
        in_memory_login_failures[key] = entry


def clear_auth_failures(scope: str, identity: str, client_ip: str = "unknown") -> None:
    for key in _rate_limit_keys(scope, identity, client_ip):
        in_memory_login_failures.pop(key, None)


def _check_otp_request_cooldown(otp_key: str, client_ip: str) -> None:
    if not settings.LOGIN_RATE_LIMIT_ENABLED:
        return
    cooldown_sec = max(0, int(settings.OTP_REQUEST_COOLDOWN_SECONDS))
    if cooldown_sec <= 0:
        return
    now_ts = time.monotonic()
    for cd_key in (otp_key, f"{otp_key}|ip:{client_ip}"):
        last_ts = in_memory_otp_cooldowns.get(cd_key)
        if last_ts is not None and (now_ts - last_ts) < cooldown_sec:
            wait_sec = max(1, int(cooldown_sec - (now_ts - last_ts) + 0.999))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Vui lòng chờ {wait_sec} giây trước khi yêu cầu gửi lại mã OTP.",
                headers={"Retry-After": str(wait_sec)},
            )


def _mark_otp_request_cooldown(otp_key: str, client_ip: str) -> None:
    if not settings.LOGIN_RATE_LIMIT_ENABLED:
        return
    now_ts = time.monotonic()
    in_memory_otp_cooldowns[otp_key] = now_ts
    in_memory_otp_cooldowns[f"{otp_key}|ip:{client_ip}"] = now_ts


def _clear_otp_request_cooldown(otp_key: str, client_ip: str) -> None:
    in_memory_otp_cooldowns.pop(otp_key, None)
    in_memory_otp_cooldowns.pop(f"{otp_key}|ip:{client_ip}", None)


def _normalize_phone(phone: str) -> str:
    cleaned = re.sub(r"[\s\-.()]", "", (phone or "").strip())
    if cleaned.startswith("+84"):
        cleaned = "0" + cleaned[3:]
    elif cleaned.startswith("84") and len(cleaned) >= 11:
        cleaned = "0" + cleaned[2:]
    if not re.fullmatch(r"\d{9,15}", cleaned):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Số điện thoại không hợp lệ (cần 9–15 chữ số).",
        )
    return cleaned


def _normalize_class_name(class_name: str) -> str:
    return re.sub(r"\s+", "", (class_name or "").strip()).upper()


def _normalize_student_code(student_code: str) -> str:
    return (student_code or "").strip().upper()


def _otp_key(email: Optional[str], phone_number: str, purpose: str = "LOGIN") -> str:
    norm_email = (email or "").strip().lower()
    norm_phone = _normalize_phone(phone_number)
    return f"{purpose}:{norm_email}:{norm_phone}"


def _detect_hash_scheme(hashed: Optional[str]) -> Optional[str]:
    if not hashed:
        return None
    if hashed.startswith("$argon2"):
        return "argon2"
    if hashed.startswith(("$2a$", "$2b$", "$2y$")):
        return "bcrypt"
    return "pbkdf2_sha256"


def _revoke_all_user_sessions(user_id: str) -> int:
    revoked_count = 0
    for sess_jti, sess in in_memory_refresh_sessions.items():
        if sess.get("user_id") == user_id and not sess.get("revoked"):
            sess["revoked"] = True
            revoked_token_jtis.add(sess_jti)
            revoked_count += 1
    return revoked_count


def _find_existing_user(email: Optional[str], phone_number: str) -> Optional[Dict[str, Any]]:
    norm_email = (email or "").strip().lower() or None
    norm_phone = _normalize_phone(phone_number)
    for user in in_memory_users.values():
        user_email = (user.get("email") or "").strip().lower() or None
        if (norm_email and user_email == norm_email) or user.get("phone_number") == norm_phone:
            return user
    return None


def _validate_existing_user_for_otp(
    existing: Optional[Dict[str, Any]],
    *,
    norm_email: Optional[str],
    norm_phone: str,
) -> None:
    if not existing:
        return
    if existing.get("role") == "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản Quản trị viên không sử dụng luồng đăng nhập OTP phòng học.",
        )
    existing_email = (existing.get("email") or "").strip().lower() or None
    existing_phone = existing.get("phone_number")
    if norm_email and existing_email and existing_email != norm_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email và số điện thoại không khớp với tài khoản đã đăng ký.",
        )
    if existing_phone and existing_phone != norm_phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email và số điện thoại không khớp với tài khoản đã đăng ký.",
        )


def _find_or_create_teacher(
    *,
    email: Optional[str],
    phone_number: str,
    full_name: Optional[str] = None,
    password: Optional[str] = None,
    role: str = "TEACHER",
    allow_password_set: bool = False,
) -> Dict[str, Any]:
    norm_email = (email or "").strip().lower() or None
    norm_phone = _normalize_phone(phone_number)

    existing = _find_existing_user(norm_email, norm_phone)

    if existing:
        if not existing.get("is_active", True):
            return existing
        if password and allow_password_set and not existing.get("password_hash") and existing.get("role") != "ADMIN":
            existing["password_hash"] = get_password_hash(password)
        if full_name and existing.get("role") != "ADMIN":
            existing["full_name"] = full_name.strip()
        if norm_email and not existing.get("email") and existing.get("role") != "ADMIN":
            existing["email"] = norm_email
        existing["updated_at"] = datetime.now(timezone.utc).isoformat()
        return existing

    pw_hash = get_password_hash(password) if (password and allow_password_set) else None
    user_id = f"teacher_{uuid.uuid4().hex[:12]}" if role == "TEACHER" else f"user_{uuid.uuid4().hex[:12]}"
    user_record = {
        "id": user_id,
        "full_name": (full_name or ("Thầy/Cô Giáo Viên" if role == "TEACHER" else "Học Sinh")).strip(),
        "email": norm_email,
        "phone_number": norm_phone,
        "role": role,
        "password_hash": pw_hash,
        "school_level": None,
        "class_name": None,
        "allowed_classes": [],
        "student_code": None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    in_memory_users[user_id] = user_record
    return user_record


def _issue_session_tokens(
    user: Dict[str, Any],
    *,
    remember_me: bool,
    device_id: str,
    device_name: str,
) -> TokenResponse:
    remember_days = settings.REFRESH_TOKEN_EXPIRE_DAYS if remember_me else 1
    refresh_ttl = timedelta(days=remember_days)
    access_ttl = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    allowed_classes: List[str] = list(user.get("allowed_classes") or [])
    if not allowed_classes and user.get("class_name"):
        allowed_classes = [user["class_name"]]

    claims = {
        "role": user["role"],
        "email": user.get("email"),
        "phone_number": user.get("phone_number"),
        "device_id": device_id,
        "school_level": user.get("school_level"),
        "class_name": user.get("class_name"),
        "allowed_classes": allowed_classes,
        "student_code": user.get("student_code"),
    }
    access_token = create_access_token(subject=user["id"], expires_delta=access_ttl, extra_claims=claims)
    refresh_token = create_refresh_token(
        subject=user["id"],
        expires_delta=refresh_ttl,
        remember_me=remember_me,
        extra_claims=claims,
    )
    refresh_payload = decode_token(refresh_token, expected_type="refresh")
    now = datetime.now(timezone.utc)
    in_memory_refresh_sessions[refresh_payload["jti"]] = {
        "jti": refresh_payload["jti"],
        "user_id": user["id"],
        "device_id": device_id,
        "device_name": device_name,
        "remember_days": remember_days,
        "created_at": now.isoformat(),
        "absolute_expires_at": (now + refresh_ttl).isoformat(),
        "revoked": False,
    }
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=int(access_ttl.total_seconds()),
        refresh_expires_in=int(refresh_ttl.total_seconds()),
        remember_days=remember_days,
        user_id=user["id"],
        role=user["role"],
        full_name=user["full_name"],
        email=user.get("email"),
        phone_number=user.get("phone_number"),
        device_id=device_id,
        password_hash_scheme=_detect_hash_scheme(user.get("password_hash")) or get_active_hash_scheme(),
        school_level=user.get("school_level"),
        class_name=user.get("class_name"),
        allowed_classes=allowed_classes,
        student_code=user.get("student_code"),
    )


def get_current_user_from_header(authorization: Optional[str], required: bool = True) -> Optional[Dict[str, Any]]:
    """Giải mã Bearer Access Token phục vụ phân quyền lớp học giữa các router."""
    if not authorization or not isinstance(authorization, str):
        if required:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Thiếu Access Token xác thực.",
            )
        return None
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Header Authorization phải theo chuẩn Bearer <token>.",
        )

    token = authorization.split(" ", 1)[1].strip()
    try:
        decoded = decode_token(token, expected_type="access")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    stored = in_memory_users.get(decoded["sub"], {})
    if stored and not stored.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị Quản trị viên tạm khóa.",
        )
    allowed_classes = stored.get("allowed_classes") or decoded.get("allowed_classes") or []
    class_name = stored.get("class_name") or decoded.get("class_name")
    if class_name and class_name not in allowed_classes:
        allowed_classes = [class_name, *allowed_classes]

    return {
        "user_id": decoded["sub"],
        "role": stored.get("role") or decoded.get("role", "STUDENT"),
        "full_name": stored.get("full_name", "Người dùng"),
        "email": stored.get("email") or decoded.get("email"),
        "phone_number": stored.get("phone_number") or decoded.get("phone_number"),
        "device_id": decoded.get("device_id"),
        "school_level": stored.get("school_level") or decoded.get("school_level"),
        "class_name": class_name,
        "allowed_classes": [_normalize_class_name(c) for c in allowed_classes if c],
        "student_code": stored.get("student_code") or decoded.get("student_code"),
        "password_hash_scheme": _detect_hash_scheme(stored.get("password_hash")) or get_active_hash_scheme(),
        "token_exp": decoded.get("exp"),
    }


def create_snapshot_signature(snapshot_id: str, expires_epoch: int) -> str:
    msg = f"snap:{snapshot_id}:{int(expires_epoch)}".encode("utf-8")
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def verify_snapshot_signature(snapshot_id: str, expires_epoch: Optional[int], signature: Optional[str]) -> bool:
    if not snapshot_id or not expires_epoch or not signature:
        return False
    try:
        exp_int = int(expires_epoch)
    except (TypeError, ValueError):
        return False
    if exp_int < int(datetime.now(timezone.utc).timestamp()):
        return False
    expected = create_snapshot_signature(snapshot_id, exp_int)
    return hmac.compare_digest(expected, str(signature))


def require_role(authorization: Optional[str], *allowed_roles: str) -> Optional[Dict[str, Any]]:
    """
    Kiểm tra vai trò theo khuôn `require_admin(authorization)` (không refactor sang Depends):
    - Khi `settings.AUTH_ENFORCE == False` (mặc định log-only): nếu chưa có token thì ghi cảnh báo và cho phép;
      nếu có token hợp lệ thì giải mã trả về user để các bước downstream dùng được danh tính.
    - Khi `settings.AUTH_ENFORCE == True`: bắt buộc Bearer token hợp lệ và khớp một trong `allowed_roles`.
    """
    auth_str = authorization if isinstance(authorization, str) else None
    normalized_roles = {r.upper() for r in allowed_roles if r}

    if not auth_str:
        if settings.AUTH_ENFORCE:
            get_current_user_from_header(None, required=True)
        logger.warning(
            "AUTH_ENFORCE=false (log-only): cho phép request chưa đính kèm Bearer token (yêu cầu role=%s)",
            sorted(normalized_roles) or ["ANY"],
        )
        return None

    user = get_current_user_from_header(auth_str, required=True)
    user_role = (user.get("role") or "").upper()
    if normalized_roles and user_role not in normalized_roles:
        if settings.AUTH_ENFORCE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Tài khoản vai trò '{user_role}' không đủ quyền thực hiện thao tác này (cần: {', '.join(sorted(normalized_roles))}).",
            )
        logger.warning(
            "AUTH_ENFORCE=false (log-only): role=%s không nằm trong %s",
            user_role,
            sorted(normalized_roles),
        )
    return user


def assert_user_can_access_class(
    user: Optional[Dict[str, Any]],
    *,
    requested_class_name: Optional[str] = None,
    requested_room_id: Optional[str] = None,
) -> None:
    """
    Giới hạn Học sinh / Phụ huynh chỉ được xem bài của lớp mình học (TF28515).
    N8: Khi bật AUTH_ENFORCE, Giáo viên cũng chỉ được thao tác trên các lớp thuộc `allowed_classes`.
    """
    if not user:
        return
    role = (user.get("role") or "").upper()
    if role == "ADMIN":
        return

    allowed = {_normalize_class_name(c) for c in (user.get("allowed_classes") or []) if c}
    if "*" in allowed:
        return

    is_teacher = role == "TEACHER"
    if is_teacher and not settings.AUTH_ENFORCE:
        if not allowed or (
            requested_class_name and _normalize_class_name(requested_class_name) not in allowed
        ):
            logger.warning(
                "AUTH_ENFORCE=false (log-only): TEACHER user_id=%s truy cập class=%s room=%s ngoài allowed_classes=%s",
                user.get("user_id"),
                requested_class_name,
                requested_room_id,
                sorted(allowed),
            )
        return

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Tài khoản Giáo viên chưa được Quản trị viên phân công lớp giảng dạy."
                if is_teacher
                else "Tài khoản chưa được gán lớp học hợp lệ."
            ),
        )

    if requested_class_name:
        if _normalize_class_name(requested_class_name) not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Giáo viên chỉ được thao tác trên lớp được phân công ({', '.join(sorted(allowed))})."
                    if is_teacher
                    else f"Bạn chỉ được phép xem bài học của lớp mình học ({', '.join(sorted(allowed))})."
                ),
            )

    if requested_room_id:
        full_norm = _normalize_class_name(requested_room_id)
        room_tokens = {
            _normalize_class_name(tok)
            for tok in re.split(r"[^a-zA-Z0-9]+", requested_room_id.strip())
            if tok and tok.upper() != "ROOM"
        }
        if (full_norm or room_tokens) and not any(
            cls == full_norm or cls in room_tokens for cls in allowed
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Không có quyền truy cập phòng học '{requested_room_id}' ngoài lớp được phân quyền.",
            )


@router.post("/teacher/register", response_model=UserOut, summary="Đăng ký tài khoản Giáo viên (băm mật khẩu Argon2/BCrypt)")
async def register_teacher(payload: TeacherRegisterRequest):
    norm_email = payload.email.strip().lower()
    norm_phone = _normalize_phone(payload.phone_number)
    for existing in in_memory_users.values():
        if existing.get("email") == norm_email or existing.get("phone_number") == norm_phone:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email hoặc số điện thoại đã được đăng ký.",
            )

    user = _find_or_create_teacher(
        email=norm_email,
        phone_number=norm_phone,
        full_name=payload.full_name,
        password=payload.password,
        role="TEACHER",
        allow_password_set=True,
    )
    return UserOut(
        id=user["id"],
        full_name=user["full_name"],
        email=user["email"],
        phone_number=user["phone_number"],
        role=user["role"],
        is_active=user["is_active"],
        password_hash_scheme=_detect_hash_scheme(user.get("password_hash")),
    )


@router.post("/request-otp", summary="Giáo viên nhập Email & SĐT để nhận mã OTP 6 số qua Email")
@router.post("/teacher/request-otp", include_in_schema=False)
async def request_otp(payload: RequestOTPRequest, request: Request):
    role = (payload.role or "TEACHER").upper()
    norm_phone = _normalize_phone(payload.phone_number)
    if role == "TEACHER" and not payload.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Giáo viên cần nhập cả Email và Số điện thoại để nhận mã OTP 6 số.",
        )

    norm_email = payload.email.strip().lower() if payload.email else None
    existing_user = _find_existing_user(norm_email, norm_phone)
    _validate_existing_user_for_otp(existing_user, norm_email=norm_email, norm_phone=norm_phone)

    client_ip = get_client_ip(request)
    key = _otp_key(norm_email, norm_phone, purpose="LOGIN")
    check_auth_rate_limit("verify_otp", key, client_ip)
    _check_otp_request_cooldown(key, client_ip)

    now_dt = datetime.now(timezone.utc)
    existing_record = in_memory_otps.get(key)
    preserved_attempts = 0
    if (
        existing_record
        and not existing_record.get("verified")
        and datetime.fromisoformat(existing_record["expires_at"]) > now_dt
    ):
        preserved_attempts = int(existing_record.get("attempts", 0))
        if preserved_attempts >= MAX_OTP_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Bạn đã nhập sai OTP quá 5 lần. Vui lòng chờ mã hiện tại hết hạn trước khi yêu cầu mã mới.",
            )

    code = generate_otp_code(6)
    expires_at = now_dt + timedelta(seconds=settings.OTP_EXPIRE_SECONDS)

    in_memory_otps[key] = {
        "otp_hash": hash_otp_code(code),
        "email": norm_email,
        "phone_number": norm_phone,
        "role": role,
        "full_name": payload.full_name,
        "expires_at": expires_at.isoformat(),
        "attempts": preserved_attempts,
        "verified": False,
    }
    _mark_otp_request_cooldown(key, client_ip)

    delivery = (
        send_otp_email(norm_email, code, payload.full_name or "Thầy/Cô Giáo Viên")
        if norm_email
        else {"delivered": True, "channel": "sms_fallback", "detail": "Mã OTP SMS dự phòng"}
    )

    resp: Dict[str, Any] = {
        "success": True,
        "message": f"Mã OTP 6 số đã được gửi tới email {norm_email or norm_phone}",
        "expires_in": settings.OTP_EXPIRE_SECONDS,
        "delivery_channel": delivery["channel"],
        "email": norm_email,
        "phone_number": norm_phone,
    }
    if settings.APP_ENV != "production":
        resp["dev_otp_code"] = code
    return resp


@router.post("/verify-otp", response_model=TokenResponse, summary="Xác thực OTP 6 số và giữ phiên 14 ngày trên thiết bị phòng học")
@router.post("/teacher/verify-otp", response_model=TokenResponse, include_in_schema=False)
async def verify_otp(payload: VerifyOTPRequest, request: Request):
    role = "TEACHER" if payload.email else "STUDENT"
    norm_email = payload.email.strip().lower() if payload.email else None
    norm_phone = _normalize_phone(payload.phone_number)
    client_ip = get_client_ip(request)
    key = _otp_key(norm_email, norm_phone, purpose="LOGIN")
    check_auth_rate_limit("verify_otp", key, client_ip)

    existing_user = _find_existing_user(norm_email, norm_phone)
    _validate_existing_user_for_otp(existing_user, norm_email=norm_email, norm_phone=norm_phone)

    record = in_memory_otps.get(key)
    can_use_dev_bypass = (
        settings.APP_ENV != "production"
        and settings.DEV_OTP_BYPASS
        and existing_user is None
        and payload.otp_code.strip() == "123456"
    )
    otp_verified_genuinely = False

    if record:
        if record.get("verified") and not can_use_dev_bypass:
            record_auth_failure("verify_otp", key, client_ip)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mã OTP này đã được sử dụng. Vui lòng yêu cầu mã OTP mới.",
            )
        if record.get("attempts", 0) >= MAX_OTP_ATTEMPTS:
            record_auth_failure("verify_otp", key, client_ip)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Bạn đã nhập sai OTP quá 5 lần. Vui lòng yêu cầu mã OTP mới.",
            )
        is_expired = datetime.fromisoformat(record["expires_at"]) < datetime.now(timezone.utc)
        if is_expired and not can_use_dev_bypass:
            record_auth_failure("verify_otp", key, client_ip)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mã OTP đã hết hạn. Vui lòng yêu cầu gửi lại mã mới.",
            )
        hash_matches = not is_expired and not record.get("verified") and verify_otp_hash(payload.otp_code, record["otp_hash"])
        if hash_matches:
            otp_verified_genuinely = True
            record["verified"] = True
            role = record.get("role", role)
        elif not can_use_dev_bypass:
            record["attempts"] = record.get("attempts", 0) + 1
            record_auth_failure("verify_otp", key, client_ip)
            if record["attempts"] >= MAX_OTP_ATTEMPTS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Bạn đã nhập sai OTP quá 5 lần. Vui lòng yêu cầu mã OTP mới.",
                )
            remaining = MAX_OTP_ATTEMPTS - record["attempts"]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Mã OTP không chính xác (còn {remaining} lần thử).",
            )
        else:
            role = record.get("role", role)
    elif not can_use_dev_bypass:
        record_auth_failure("verify_otp", key, client_ip)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chưa có yêu cầu OTP hoặc mã OTP đã hết hạn.",
        )

    if role == "ADMIN":
        role = "TEACHER"

    clear_auth_failures("verify_otp", key, client_ip)
    if otp_verified_genuinely:
        _clear_otp_request_cooldown(key, client_ip)

    user = _find_or_create_teacher(
        email=norm_email,
        phone_number=norm_phone,
        full_name=payload.full_name or (record.get("full_name") if record else None),
        password=payload.password if otp_verified_genuinely else None,
        role=role,
        allow_password_set=otp_verified_genuinely,
    )
    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị Quản trị viên tạm khóa.",
        )
    return _issue_session_tokens(
        user,
        remember_me=payload.remember_me,
        device_id=payload.device_id or "smartboard-room-default",
        device_name=payload.device_name or "Bảng thông minh phòng học",
    )


@router.post("/teacher/login-password", response_model=TokenResponse, summary="Đăng nhập Giáo viên bằng mật khẩu băm Argon2/BCrypt")
async def teacher_login_password(payload: TeacherPasswordLoginRequest, request: Request):
    norm_email = payload.email.strip().lower() if payload.email else None
    norm_phone = _normalize_phone(payload.phone_number) if payload.phone_number else None
    if not norm_email and not norm_phone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Vui lòng nhập Email hoặc Số điện thoại.",
        )

    client_ip = get_client_ip(request)
    identity = norm_email or norm_phone or "unknown"
    check_auth_rate_limit("teacher_pw", identity, client_ip)

    matched = None
    for user in in_memory_users.values():
        if (norm_email and user.get("email") == norm_email) or (norm_phone and user.get("phone_number") == norm_phone):
            matched = user
            break

    if not matched or not matched.get("password_hash") or not verify_password(payload.password, matched["password_hash"]):
        record_auth_failure("teacher_pw", identity, client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Thông tin đăng nhập hoặc mật khẩu không chính xác.",
        )

    if not matched.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản giáo viên đã bị Quản trị viên tạm khóa.",
        )

    clear_auth_failures("teacher_pw", identity, client_ip)
    return _issue_session_tokens(
        matched,
        remember_me=payload.remember_me,
        device_id=payload.device_id or "smartboard-room-default",
        device_name=payload.device_name or "Bảng thông minh phòng học",
    )


@router.post("/student/register", response_model=TokenResponse, summary="TF28515: Đăng ký SĐT Học sinh (THCS/THPT) hoặc Phụ huynh (Tiểu học) — 1 học sinh/1 tài khoản")
async def register_student_or_parent(payload: StudentParentRegisterRequest):
    level = (payload.school_level or "").strip().upper()
    if level not in VALID_SCHOOL_LEVELS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cấp học phải là TIEU_HOC, THCS hoặc THPT.",
        )

    inferred_role = "PARENT" if level == "TIEU_HOC" else "STUDENT"
    role = (payload.role or inferred_role).strip().upper()
    if level == "TIEU_HOC" and role != "PARENT":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Học sinh Tiểu học bắt buộc đăng ký bằng SĐT phụ huynh (role=PARENT).",
        )
    if role not in ("STUDENT", "PARENT"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Vai trò đăng ký phải là STUDENT hoặc PARENT.",
        )

    norm_phone = _normalize_phone(payload.phone_number)
    norm_student_code = _normalize_student_code(payload.student_code)
    norm_class = _normalize_class_name(payload.class_name)

    # Ràng buộc cứng: Mỗi học sinh chỉ được gắn duy nhất 1 tài khoản định danh
    if norm_student_code in in_memory_student_bindings:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Học sinh mã '{norm_student_code}' đã được gắn tài khoản. Mỗi học sinh chỉ được gắn 1 tài khoản.",
        )

    for existing in in_memory_users.values():
        if existing.get("phone_number") == norm_phone:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Số điện thoại này đã được đăng ký cho một tài khoản khác.",
            )

    user_id = f"{role.lower()}_{uuid.uuid4().hex[:12]}"
    user_record = {
        "id": user_id,
        "full_name": payload.full_name.strip(),
        "email": None,
        "phone_number": norm_phone,
        "role": role,
        "password_hash": get_password_hash(payload.password),
        "school_level": level,
        "class_name": norm_class,
        "allowed_classes": [norm_class],
        "student_code": norm_student_code,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    in_memory_users[user_id] = user_record
    in_memory_student_bindings[norm_student_code] = user_id

    return _issue_session_tokens(
        user_record,
        remember_me=True,
        device_id="home-portal-device",
        device_name="Cổng ôn tập tại nhà",
    )


@router.post("/student/login", response_model=TokenResponse, summary="TF28515: Đăng nhập Học sinh/Phụ huynh bằng SĐT & mật khẩu kèm phân quyền lớp")
async def login_student_or_parent(payload: StudentParentLoginRequest, request: Request):
    norm_phone = _normalize_phone(payload.phone_number)
    client_ip = get_client_ip(request)
    check_auth_rate_limit("student_pw", norm_phone, client_ip)

    matched = None
    for user in in_memory_users.values():
        if user.get("phone_number") == norm_phone and user.get("role") in ("STUDENT", "PARENT"):
            matched = user
            break

    if not matched or not matched.get("password_hash") or not verify_password(payload.password, matched["password_hash"]):
        record_auth_failure("student_pw", norm_phone, client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Số điện thoại hoặc mật khẩu không chính xác.",
        )

    if not matched.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị Quản trị viên tạm khóa.",
        )

    clear_auth_failures("student_pw", norm_phone, client_ip)
    return _issue_session_tokens(
        matched,
        remember_me=payload.remember_me,
        device_id=payload.device_id or "home-portal-device",
        device_name=payload.device_name or "Cổng ôn tập tại nhà",
    )


@router.post("/forgot-password/request-otp", summary="TF28515: Yêu cầu mã OTP 6 số lấy lại mật khẩu qua SĐT")
async def forgot_password_request_otp(payload: ForgotPasswordOTPRequest, request: Request):
    norm_phone = _normalize_phone(payload.phone_number)
    client_ip = get_client_ip(request)
    key = _otp_key(None, norm_phone, purpose="RESET_PW")
    check_auth_rate_limit("reset_otp", key, client_ip)
    _check_otp_request_cooldown(key, client_ip)

    matched = None
    for user in in_memory_users.values():
        if user.get("phone_number") == norm_phone:
            matched = user
            break

    if not matched:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản nào đăng ký với số điện thoại này.",
        )

    now_dt = datetime.now(timezone.utc)
    existing_record = in_memory_otps.get(key)
    preserved_attempts = 0
    if (
        existing_record
        and not existing_record.get("verified")
        and datetime.fromisoformat(existing_record["expires_at"]) > now_dt
    ):
        preserved_attempts = int(existing_record.get("attempts", 0))
        if preserved_attempts >= MAX_OTP_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Đã vượt quá 5 lần nhập sai OTP. Vui lòng chờ mã hiện tại hết hạn trước khi yêu cầu mã mới.",
            )

    code = generate_otp_code(6)
    expires_at = now_dt + timedelta(seconds=settings.OTP_EXPIRE_SECONDS)
    in_memory_otps[key] = {
        "otp_hash": hash_otp_code(code),
        "user_id": matched["id"],
        "phone_number": norm_phone,
        "expires_at": expires_at.isoformat(),
        "attempts": preserved_attempts,
        "verified": False,
    }
    _mark_otp_request_cooldown(key, client_ip)

    resp: Dict[str, Any] = {
        "success": True,
        "message": f"Mã OTP khôi phục mật khẩu gồm 6 số đã được gửi tới SĐT {norm_phone}.",
        "expires_in": settings.OTP_EXPIRE_SECONDS,
        "phone_number": norm_phone,
    }
    if settings.APP_ENV != "production":
        resp["dev_otp_code"] = code
    return resp


@router.post("/forgot-password/reset", summary="TF28515: Xác thực OTP và đặt lại mật khẩu mới (băm Argon2/BCrypt)")
async def forgot_password_reset(payload: ResetPasswordOTPRequest, request: Request):
    norm_phone = _normalize_phone(payload.phone_number)
    client_ip = get_client_ip(request)
    key = _otp_key(None, norm_phone, purpose="RESET_PW")
    check_auth_rate_limit("reset_otp", key, client_ip)
    record = in_memory_otps.get(key)
    if not record or record.get("verified"):
        record_auth_failure("reset_otp", key, client_ip)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chưa có yêu cầu OTP khôi phục mật khẩu hoặc mã OTP đã được sử dụng.",
        )

    if record.get("attempts", 0) >= MAX_OTP_ATTEMPTS:
        record_auth_failure("reset_otp", key, client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Đã vượt quá 5 lần nhập sai OTP. Vui lòng yêu cầu gửi lại mã mới.",
        )

    if datetime.fromisoformat(record["expires_at"]) < datetime.now(timezone.utc):
        record_auth_failure("reset_otp", key, client_ip)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mã OTP khôi phục mật khẩu đã hết hạn.",
        )

    if not verify_otp_hash(payload.otp_code, record["otp_hash"]):
        record["attempts"] = record.get("attempts", 0) + 1
        record_auth_failure("reset_otp", key, client_ip)
        if record["attempts"] >= MAX_OTP_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Đã vượt quá 5 lần nhập sai OTP. Vui lòng yêu cầu gửi lại mã mới.",
            )
        remaining = MAX_OTP_ATTEMPTS - record["attempts"]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mã OTP không chính xác (còn {remaining} lần thử).",
        )

    clear_auth_failures("reset_otp", key, client_ip)
    _clear_otp_request_cooldown(key, client_ip)

    user = in_memory_users.get(record["user_id"])
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản.")

    user["password_hash"] = get_password_hash(payload.new_password)
    user["updated_at"] = datetime.now(timezone.utc).isoformat()
    record["verified"] = True
    revoked_sessions = _revoke_all_user_sessions(user["id"])

    return {
        "success": True,
        "message": "Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.",
        "password_hash_scheme": _detect_hash_scheme(user["password_hash"]),
        "revoked_sessions": revoked_sessions,
    }


@router.get("/student/lessons", summary="TF28515 / TF2851F: Xem bài học (Snapshot) giới hạn theo đúng lớp của Học sinh/Phụ huynh")
async def list_student_class_lessons(
    class_name: Optional[str] = Query(default=None, description="Tên lớp cần xem (mặc định lớp của học sinh)"),
    subject: Optional[str] = Query(default=None),
    date: Optional[str] = Query(default=None, description="Lọc theo ngày YYYY-MM-DD"),
    q: Optional[str] = Query(default=None, description="Tìm kiếm theo công thức OCR/LaTeX hoặc tên giáo viên"),
    limit: int = Query(default=24, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    authorization: Optional[str] = Header(default=None),
):
    user = get_current_user_from_header(authorization, required=True)
    assert_user_can_access_class(user, requested_class_name=class_name)

    allowed = set(user["allowed_classes"])
    class_scoped = []
    for snap in in_memory_snapshots:
        snap_class = _normalize_class_name(snap.get("tags", {}).get("class_name", ""))
        if user["role"] in ("TEACHER", "ADMIN"):
            if class_name and snap_class != _normalize_class_name(class_name):
                continue
        elif snap_class not in allowed:
            continue
        class_scoped.append(snap)

    calendar_counts: Dict[str, int] = {}
    for item in class_scoped:
        d = item.get("tags", {}).get("date")
        if d:
            calendar_counts[d] = calendar_counts.get(d, 0) + 1

    results = []
    q_low = (q or "").strip().lower()
    for snap in class_scoped:
        tags = snap.get("tags", {})
        if subject and tags.get("subject", "").lower() != subject.lower():
            continue
        if date and tags.get("date") != date:
            continue
        if q_low:
            haystack = " ".join([
                snap.get("ocr_text_metadata") or "",
                snap.get("recognized_latex") or "",
                tags.get("teacher_name") or "",
                tags.get("subject") or "",
            ]).lower()
            if q_low not in haystack:
                continue
        enriched = dict(snap)
        if enriched.get("id"):
            snap_exp = int(datetime.now(timezone.utc).timestamp()) + 300
            snap_sig = create_snapshot_signature(enriched["id"], snap_exp)
            enriched["signed_exp"] = snap_exp
            enriched["signed_sig"] = snap_sig
            if not enriched.get("preview_url"):
                enriched["preview_url"] = f"/api/v1/sessions/snapshots/{enriched['id']}/image?format=webp"
        results.append(enriched)

    total_count = len(results)
    paged = results[offset:offset + limit]
    return {
        "role": user["role"],
        "allowed_classes": user["allowed_classes"],
        "count": len(paged),
        "total_count": total_count,
        "calendar_counts": calendar_counts,
        "items": paged,
    }


@router.post("/refresh", response_model=TokenResponse, summary="Làm mới Access Token trong thời hạn duy trì 14 ngày")
async def refresh_session(payload: RefreshTokenRequest):
    try:
        decoded = decode_token(payload.refresh_token, expected_type="refresh")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    jti = decoded.get("jti")
    session = in_memory_refresh_sessions.get(jti)
    if not session or session.get("revoked"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập trên thiết bị phòng học đã hết hiệu lực hoặc đã đăng xuất.",
        )

    if payload.device_id and session.get("device_id") != payload.device_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh Token không khớp với thiết bị phòng học hiện tại.",
        )

    abs_exp = datetime.fromisoformat(session["absolute_expires_at"])
    now = datetime.now(timezone.utc)
    if abs_exp <= now:
        session["revoked"] = True
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên duy trì 14 ngày đã hết hạn. Vui lòng xác thực OTP lại.",
        )

    stored_user = in_memory_users.get(decoded["sub"])
    if stored_user is not None and not stored_user.get("is_active", True):
        session["revoked"] = True
        revoked_token_jtis.add(jti)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị Quản trị viên tạm khóa.",
        )

    user = stored_user or {
        "id": decoded["sub"],
        "full_name": "Thầy/Cô Giáo Viên",
        "email": decoded.get("email"),
        "phone_number": decoded.get("phone_number", ""),
        "role": decoded.get("role", "TEACHER"),
        "school_level": decoded.get("school_level"),
        "class_name": decoded.get("class_name"),
        "allowed_classes": decoded.get("allowed_classes") or [],
        "student_code": decoded.get("student_code"),
        "password_hash": None,
    }

    session["revoked"] = True
    revoked_token_jtis.add(jti)

    remaining_delta = abs_exp - now
    access_ttl = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    allowed_classes = list(user.get("allowed_classes") or [])
    if not allowed_classes and user.get("class_name"):
        allowed_classes = [user["class_name"]]

    claims = {
        "role": user["role"],
        "email": user.get("email"),
        "phone_number": user.get("phone_number"),
        "device_id": session["device_id"],
        "school_level": user.get("school_level"),
        "class_name": user.get("class_name"),
        "allowed_classes": allowed_classes,
        "student_code": user.get("student_code"),
    }
    new_access = create_access_token(subject=user["id"], expires_delta=access_ttl, extra_claims=claims)
    new_refresh = create_refresh_token(
        subject=user["id"],
        expires_delta=remaining_delta,
        remember_me=True,
        extra_claims=claims,
    )
    new_decoded = decode_token(new_refresh, expected_type="refresh")
    in_memory_refresh_sessions[new_decoded["jti"]] = {
        "jti": new_decoded["jti"],
        "user_id": user["id"],
        "device_id": session["device_id"],
        "device_name": session["device_name"],
        "remember_days": session["remember_days"],
        "created_at": now.isoformat(),
        "absolute_expires_at": session["absolute_expires_at"],
        "revoked": False,
    }

    return TokenResponse(
        access_token=new_access,
        refresh_token=new_refresh,
        token_type="bearer",
        expires_in=int(access_ttl.total_seconds()),
        refresh_expires_in=max(1, int(remaining_delta.total_seconds())),
        remember_days=session["remember_days"],
        user_id=user["id"],
        role=user["role"],
        full_name=user["full_name"],
        email=user.get("email"),
        phone_number=user.get("phone_number"),
        device_id=session["device_id"],
        password_hash_scheme=_detect_hash_scheme(user.get("password_hash")) or get_active_hash_scheme(),
        school_level=user.get("school_level"),
        class_name=user.get("class_name"),
        allowed_classes=allowed_classes,
        student_code=user.get("student_code"),
    )


@router.get("/me", summary="Kiểm tra phiên đăng nhập hiện tại qua Bearer JWT")
async def get_current_teacher(authorization: Optional[str] = Header(default=None)):
    return get_current_user_from_header(authorization, required=True)


@router.post("/logout", summary="Đăng xuất và thu hồi Refresh Token trên thiết bị phòng học")
async def logout(payload: LogoutRequest):
    revoked_count = 0
    if payload.refresh_token:
        try:
            decoded = decode_token(payload.refresh_token, expected_type="refresh")
            jti = decoded.get("jti")
            sub = decoded.get("sub")
            if jti and jti in in_memory_refresh_sessions:
                in_memory_refresh_sessions[jti]["revoked"] = True
                revoked_token_jtis.add(jti)
                revoked_count += 1
            if payload.revoke_all_devices and sub:
                revoked_count += _revoke_all_user_sessions(sub)
        except ValueError:
            pass
    return {"success": True, "revoked_sessions": revoked_count}
