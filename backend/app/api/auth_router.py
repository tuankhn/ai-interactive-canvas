import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import uuid

from fastapi import APIRouter, Header, HTTPException, status

from app.core.config import settings
from app.core.database import (
    in_memory_otps,
    in_memory_refresh_sessions,
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
    LogoutRequest,
    RefreshTokenRequest,
    RequestOTPRequest,
    TeacherPasswordLoginRequest,
    TeacherRegisterRequest,
    TokenResponse,
    UserOut,
    VerifyOTPRequest,
)

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication & Teacher 14-Day Session (TF28514)"])

# Alias tương thích ngược cho các module cũ nếu có import OTP_STORE
OTP_STORE = in_memory_otps

MAX_OTP_ATTEMPTS = 5


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


def _otp_key(email: Optional[str], phone_number: str) -> str:
    norm_email = (email or "").strip().lower()
    norm_phone = _normalize_phone(phone_number)
    return f"{norm_email}:{norm_phone}"


def _detect_hash_scheme(hashed: Optional[str]) -> Optional[str]:
    if not hashed:
        return None
    if hashed.startswith("$argon2"):
        return "argon2"
    if hashed.startswith(("$2a$", "$2b$", "$2y$")):
        return "bcrypt"
    return "pbkdf2_sha256"


def _find_or_create_teacher(
    *,
    email: Optional[str],
    phone_number: str,
    full_name: Optional[str] = None,
    password: Optional[str] = None,
    role: str = "TEACHER",
) -> Dict[str, Any]:
    norm_email = (email or "").strip().lower() or None
    norm_phone = _normalize_phone(phone_number)

    existing = None
    for user in in_memory_users.values():
        if (norm_email and user.get("email") == norm_email) or user.get("phone_number") == norm_phone:
            existing = user
            break

    if existing:
        if password:
            existing["password_hash"] = get_password_hash(password)
        if full_name:
            existing["full_name"] = full_name.strip()
        if norm_email and not existing.get("email"):
            existing["email"] = norm_email
        existing["updated_at"] = datetime.now(timezone.utc).isoformat()
        return existing

    # Nếu chưa có mật khẩu riêng, tạo hash Argon2/BCrypt mặc định phục vụ bảo mật tài khoản nội bộ
    pw_hash = get_password_hash(password) if password else None
    user_id = f"teacher_{uuid.uuid4().hex[:12]}" if role == "TEACHER" else f"user_{uuid.uuid4().hex[:12]}"
    user_record = {
        "id": user_id,
        "full_name": (full_name or ("Thầy/Cô Giáo Viên" if role == "TEACHER" else "Học Sinh")).strip(),
        "email": norm_email,
        "phone_number": norm_phone,
        "role": role,
        "password_hash": pw_hash,
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
    claims = {
        "role": user["role"],
        "email": user.get("email"),
        "phone_number": user.get("phone_number"),
        "device_id": device_id,
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
async def request_otp(payload: RequestOTPRequest):
    role = (payload.role or "TEACHER").upper()
    norm_phone = _normalize_phone(payload.phone_number)
    if role == "TEACHER" and not payload.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Giáo viên cần nhập cả Email và Số điện thoại để nhận mã OTP 6 số.",
        )

    norm_email = payload.email.strip().lower() if payload.email else None
    code = generate_otp_code(6)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.OTP_EXPIRE_SECONDS)
    key = _otp_key(norm_email, norm_phone)

    in_memory_otps[key] = {
        "otp_hash": hash_otp_code(code),
        "email": norm_email,
        "phone_number": norm_phone,
        "role": role,
        "full_name": payload.full_name,
        "expires_at": expires_at.isoformat(),
        "attempts": 0,
        "verified": False,
    }

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
async def verify_otp(payload: VerifyOTPRequest):
    role = "TEACHER" if payload.email else "STUDENT"
    norm_email = payload.email.strip().lower() if payload.email else None
    norm_phone = _normalize_phone(payload.phone_number)
    key = _otp_key(norm_email, norm_phone)
    record = in_memory_otps.get(key)

    is_dev_demo_code = settings.APP_ENV != "production" and payload.otp_code.strip() == "123456"

    if record:
        if record.get("attempts", 0) >= MAX_OTP_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Bạn đã nhập sai OTP quá 5 lần. Vui lòng yêu cầu mã OTP mới.",
            )
        if datetime.fromisoformat(record["expires_at"]) < datetime.now(timezone.utc) and not is_dev_demo_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mã OTP đã hết hạn. Vui lòng yêu cầu gửi lại mã mới.",
            )
        if not verify_otp_hash(payload.otp_code, record["otp_hash"]) and not is_dev_demo_code:
            record["attempts"] = record.get("attempts", 0) + 1
            remaining = MAX_OTP_ATTEMPTS - record["attempts"]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Mã OTP không chính xác (còn {remaining} lần thử).",
            )
        record["verified"] = True
        role = record.get("role", role)
    elif not is_dev_demo_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chưa có yêu cầu OTP hoặc mã OTP đã hết hạn.",
        )

    user = _find_or_create_teacher(
        email=norm_email,
        phone_number=norm_phone,
        full_name=payload.full_name or (record.get("full_name") if record else None),
        password=payload.password,
        role=role,
    )
    return _issue_session_tokens(
        user,
        remember_me=payload.remember_me,
        device_id=payload.device_id or "smartboard-room-default",
        device_name=payload.device_name or "Bảng thông minh phòng học",
    )


@router.post("/teacher/login-password", response_model=TokenResponse, summary="Đăng nhập Giáo viên bằng mật khẩu băm Argon2/BCrypt")
async def teacher_login_password(payload: TeacherPasswordLoginRequest):
    norm_email = payload.email.strip().lower() if payload.email else None
    norm_phone = _normalize_phone(payload.phone_number) if payload.phone_number else None
    if not norm_email and not norm_phone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Vui lòng nhập Email hoặc Số điện thoại.",
        )

    matched = None
    for user in in_memory_users.values():
        if (norm_email and user.get("email") == norm_email) or (norm_phone and user.get("phone_number") == norm_phone):
            matched = user
            break

    if not matched or not matched.get("password_hash") or not verify_password(payload.password, matched["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Thông tin đăng nhập hoặc mật khẩu không chính xác.",
        )

    return _issue_session_tokens(
        matched,
        remember_me=payload.remember_me,
        device_id=payload.device_id or "smartboard-room-default",
        device_name=payload.device_name or "Bảng thông minh phòng học",
    )


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

    user = in_memory_users.get(decoded["sub"]) or {
        "id": decoded["sub"],
        "full_name": "Thầy/Cô Giáo Viên",
        "email": decoded.get("email"),
        "phone_number": decoded.get("phone_number", ""),
        "role": decoded.get("role", "TEACHER"),
        "password_hash": None,
    }

    # Thu hồi refresh token cũ (rotation) và giữ nguyên hạn tuyệt đối 14 ngày của thiết bị
    session["revoked"] = True
    revoked_token_jtis.add(jti)

    remaining_delta = abs_exp - now
    access_ttl = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    claims = {
        "role": user["role"],
        "email": user.get("email"),
        "phone_number": user.get("phone_number"),
        "device_id": session["device_id"],
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
    )


@router.get("/me", summary="Kiểm tra phiên đăng nhập hiện tại qua Bearer JWT")
async def get_current_teacher(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Thiếu Access Token xác thực.",
        )
    token = authorization.split(" ", 1)[1].strip()
    try:
        decoded = decode_token(token, expected_type="access")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    user = in_memory_users.get(decoded["sub"], {})
    return {
        "user_id": decoded["sub"],
        "role": decoded.get("role", user.get("role", "TEACHER")),
        "full_name": user.get("full_name", "Thầy/Cô Giáo Viên"),
        "email": user.get("email") or decoded.get("email"),
        "phone_number": user.get("phone_number") or decoded.get("phone_number"),
        "device_id": decoded.get("device_id"),
        "password_hash_scheme": _detect_hash_scheme(user.get("password_hash")) or get_active_hash_scheme(),
        "token_exp": decoded.get("exp"),
    }


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
                for sess_jti, sess in in_memory_refresh_sessions.items():
                    if sess.get("user_id") == sub and not sess.get("revoked"):
                        sess["revoked"] = True
                        revoked_token_jtis.add(sess_jti)
                        revoked_count += 1
        except ValueError:
            pass
    return {"success": True, "revoked_sessions": revoked_count}
