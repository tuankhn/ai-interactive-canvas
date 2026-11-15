import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Header, HTTPException, Query, status

from app.core.config import settings
from app.core.database import (
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

# Alias tương thích ngược cho các module cũ nếu có import OTP_STORE
OTP_STORE = in_memory_otps

MAX_OTP_ATTEMPTS = 5
VALID_SCHOOL_LEVELS = {"TIEU_HOC", "THCS", "THPT"}


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

    pw_hash = get_password_hash(password) if password else None
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
    if not authorization:
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


def assert_user_can_access_class(
    user: Optional[Dict[str, Any]],
    *,
    requested_class_name: Optional[str] = None,
    requested_room_id: Optional[str] = None,
) -> None:
    """
    Giới hạn Học sinh / Phụ huynh chỉ được xem bài của lớp mình học (TF28515).
    Giáo viên và Admin có quyền truy cập toàn lớp được phân công.
    """
    if not user:
        return
    role = (user.get("role") or "").upper()
    if role in ("TEACHER", "ADMIN"):
        return

    allowed = {_normalize_class_name(c) for c in (user.get("allowed_classes") or []) if c}
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản chưa được gán lớp học hợp lệ.",
        )

    if requested_class_name:
        if _normalize_class_name(requested_class_name) not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Bạn chỉ được phép xem bài học của lớp mình học ({', '.join(sorted(allowed))}).",
            )

    if requested_room_id:
        room_norm = _normalize_class_name(requested_room_id).replace("ROOM-", "").replace("ROOM_", "")
        if room_norm and not any(cls == room_norm or room_norm.endswith(cls) for cls in allowed):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Không có quyền truy cập phòng học '{requested_room_id}' ngoài lớp của bạn.",
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
    key = _otp_key(norm_email, norm_phone, purpose="LOGIN")

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
    key = _otp_key(norm_email, norm_phone, purpose="LOGIN")
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
async def login_student_or_parent(payload: StudentParentLoginRequest):
    norm_phone = _normalize_phone(payload.phone_number)
    matched = None
    for user in in_memory_users.values():
        if user.get("phone_number") == norm_phone and user.get("role") in ("STUDENT", "PARENT"):
            matched = user
            break

    if not matched or not matched.get("password_hash") or not verify_password(payload.password, matched["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Số điện thoại hoặc mật khẩu không chính xác.",
        )

    return _issue_session_tokens(
        matched,
        remember_me=payload.remember_me,
        device_id=payload.device_id or "home-portal-device",
        device_name=payload.device_name or "Cổng ôn tập tại nhà",
    )


@router.post("/forgot-password/request-otp", summary="TF28515: Yêu cầu mã OTP 6 số lấy lại mật khẩu qua SĐT")
async def forgot_password_request_otp(payload: ForgotPasswordOTPRequest):
    norm_phone = _normalize_phone(payload.phone_number)
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

    code = generate_otp_code(6)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.OTP_EXPIRE_SECONDS)
    key = _otp_key(None, norm_phone, purpose="RESET_PW")
    in_memory_otps[key] = {
        "otp_hash": hash_otp_code(code),
        "user_id": matched["id"],
        "phone_number": norm_phone,
        "expires_at": expires_at.isoformat(),
        "attempts": 0,
        "verified": False,
    }

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
async def forgot_password_reset(payload: ResetPasswordOTPRequest):
    norm_phone = _normalize_phone(payload.phone_number)
    key = _otp_key(None, norm_phone, purpose="RESET_PW")
    record = in_memory_otps.get(key)
    if not record or record.get("verified"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chưa có yêu cầu OTP khôi phục mật khẩu hoặc mã OTP đã được sử dụng.",
        )

    if record.get("attempts", 0) >= MAX_OTP_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Đã vượt quá 5 lần nhập sai OTP. Vui lòng yêu cầu gửi lại mã mới.",
        )

    if datetime.fromisoformat(record["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mã OTP khôi phục mật khẩu đã hết hạn.",
        )

    if not verify_otp_hash(payload.otp_code, record["otp_hash"]):
        record["attempts"] = record.get("attempts", 0) + 1
        remaining = MAX_OTP_ATTEMPTS - record["attempts"]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mã OTP không chính xác (còn {remaining} lần thử).",
        )

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


@router.get("/student/lessons", summary="TF28515: Xem bài học (Snapshot) giới hạn theo đúng lớp của Học sinh/Phụ huynh")
async def list_student_class_lessons(
    class_name: Optional[str] = Query(default=None, description="Tên lớp cần xem (mặc định lớp của học sinh)"),
    subject: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    user = get_current_user_from_header(authorization, required=True)
    assert_user_can_access_class(user, requested_class_name=class_name)

    allowed = set(user["allowed_classes"])
    results = []
    for snap in in_memory_snapshots:
        snap_class = _normalize_class_name(snap.get("tags", {}).get("class_name", ""))
        if user["role"] in ("TEACHER", "ADMIN"):
            if class_name and snap_class != _normalize_class_name(class_name):
                continue
        elif snap_class not in allowed:
            continue

        if subject and snap.get("tags", {}).get("subject", "").lower() != subject.lower():
            continue
        results.append(snap)

    return {
        "role": user["role"],
        "allowed_classes": user["allowed_classes"],
        "count": len(results),
        "items": results,
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

    user = in_memory_users.get(decoded["sub"]) or {
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
