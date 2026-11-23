import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request, status

from app.api.auth_router import (
    _detect_hash_scheme,
    _issue_session_tokens,
    _normalize_class_name,
    _normalize_phone,
    _revoke_all_user_sessions,
    check_auth_rate_limit,
    clear_auth_failures,
    get_client_ip,
    get_current_user_from_header,
    record_auth_failure,
)
from app.core.config import settings
from app.core.database import (
    in_memory_ai_quotas,
    in_memory_ai_usage_logs,
    in_memory_classes,
    in_memory_schools,
    in_memory_snapshots,
    in_memory_users,
    record_ai_usage_event,
)
from app.core.security import get_active_hash_scheme, get_password_hash, verify_password
from app.core.storage import HAS_MINIO
from app.schemas.admin import (
    AIQuotaUpdateRequest,
    AdminLoginRequest,
    ClassAssignTeacherRequest,
    ClassCreateRequest,
    RecordAIUsageRequest,
    SchoolCreateRequest,
    SchoolUpdateRequest,
    TeacherProvisionRequest,
    TeacherUpdateRequest,
)
from app.schemas.auth import TokenResponse

router = APIRouter(
    prefix="/api/v1/admin",
    tags=["Admin Portal: Schools, Classes, Teachers & AI/MinIO Quotas (TF28528)"],
)


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return cleaned or uuid.uuid4().hex[:6]


def _ensure_default_admin() -> Dict[str, Any]:
    """Đảm bảo có sẵn tài khoản Quản trị viên mặc định phục vụ đăng nhập Admin Portal."""
    admin_email = settings.ADMIN_EMAIL.strip().lower()
    for user in in_memory_users.values():
        if user.get("role") == "ADMIN" and (user.get("email") or "").lower() == admin_email:
            return user

    now = datetime.now(timezone.utc).isoformat()
    admin_id = "admin_default"
    admin_record = {
        "id": admin_id,
        "full_name": "Quản Trị Viên Hệ Thống",
        "email": admin_email,
        "phone_number": "0900000001",
        "role": "ADMIN",
        "password_hash": get_password_hash(settings.ADMIN_PASSWORD),
        "school_id": None,
        "school_level": None,
        "class_name": None,
        "allowed_classes": ["*"],
        "student_code": None,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    in_memory_users[admin_id] = admin_record
    return admin_record


def require_admin(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Xác thực Bearer JWT và bắt buộc vai trò ADMIN cho toàn bộ API quản trị."""
    user = get_current_user_from_header(authorization, required=True)
    if user.get("role") != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ Quản trị viên (ADMIN) mới có quyền truy cập chức năng này.",
        )
    return user


def _sync_teacher_class_assignment(teacher_id: Optional[str], class_name: str) -> None:
    if not teacher_id:
        return
    teacher = in_memory_users.get(teacher_id)
    if not teacher or teacher.get("role") != "TEACHER":
        return
    norm_cls = _normalize_class_name(class_name)
    classes = list(teacher.get("allowed_classes") or [])
    if norm_cls and norm_cls not in classes:
        classes.append(norm_cls)
        teacher["allowed_classes"] = classes
        teacher["updated_at"] = datetime.now(timezone.utc).isoformat()


def _revoke_orphan_class_permissions(removed_class_names: List[str]) -> None:
    """H11: Thu hồi tên lớp khỏi allowed_classes của giáo viên chỉ khi không còn lớp nào cùng tên chuẩn hóa."""
    active_names = {
        _normalize_class_name(cls.get("name") or "")
        for cls in in_memory_classes.values()
        if cls.get("name")
    }
    orphaned = {
        _normalize_class_name(name)
        for name in removed_class_names
        if name and _normalize_class_name(name) not in active_names
    }
    if not orphaned:
        return
    now = datetime.now(timezone.utc).isoformat()
    for user in in_memory_users.values():
        if user.get("role") != "TEACHER":
            continue
        current = list(user.get("allowed_classes") or [])
        filtered = [c for c in current if _normalize_class_name(c) not in orphaned]
        if len(filtered) != len(current):
            user["allowed_classes"] = filtered
            user["updated_at"] = now


def _serialize_school(school: Dict[str, Any]) -> Dict[str, Any]:
    school_id = school["id"]
    class_count = sum(1 for c in in_memory_classes.values() if c.get("school_id") == school_id)
    teacher_count = sum(
        1
        for u in in_memory_users.values()
        if u.get("role") == "TEACHER" and u.get("school_id") == school_id
    )
    return {
        **school,
        "class_count": class_count,
        "teacher_count": teacher_count,
    }


def _serialize_class(cls: Dict[str, Any]) -> Dict[str, Any]:
    school = in_memory_schools.get(cls.get("school_id", ""), {})
    teacher = in_memory_users.get(cls.get("homeroom_teacher_id") or "", {})
    norm_cls = _normalize_class_name(cls["name"])
    snapshot_count = sum(
        1
        for snap in in_memory_snapshots
        if _normalize_class_name(snap.get("tags", {}).get("class_name", "")) == norm_cls
    )
    return {
        **cls,
        "school_name": school.get("name"),
        "school_code": school.get("code"),
        "homeroom_teacher_name": teacher.get("full_name") if teacher else None,
        "homeroom_teacher_email": teacher.get("email") if teacher else None,
        "snapshot_count": snapshot_count,
    }


def _serialize_teacher(user: Dict[str, Any]) -> Dict[str, Any]:
    school = in_memory_schools.get(user.get("school_id") or "", {})
    return {
        "id": user["id"],
        "full_name": user["full_name"],
        "email": user.get("email"),
        "phone_number": user.get("phone_number"),
        "role": user["role"],
        "school_id": user.get("school_id"),
        "school_name": school.get("name") if school else None,
        "allowed_classes": list(user.get("allowed_classes") or []),
        "password_hash_scheme": _detect_hash_scheme(user.get("password_hash")) or get_active_hash_scheme(),
        "is_active": bool(user.get("is_active", True)),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }


def _summarize_ai_provider(logs: List[Dict[str, Any]], provider: str, limit: int) -> Dict[str, Any]:
    matched = [item for item in logs if item.get("provider") == provider]
    total_calls = len(matched)
    live_calls = sum(1 for item in matched if not item.get("is_mock"))
    mock_calls = total_calls - live_calls
    avg_latency_ms = round(sum(item.get("latency_ms", 0) for item in matched) / total_calls) if total_calls else 0
    total_tokens = sum(item.get("estimated_tokens", 0) for item in matched)
    usage_percent = round((total_calls / limit) * 100, 2) if limit > 0 else 0.0

    by_subject: Dict[str, int] = {}
    for item in matched:
        subj = item.get("subject") or "KHAC"
        by_subject[subj] = by_subject.get(subj, 0) + 1

    return {
        "provider": provider,
        "total_calls": total_calls,
        "live_calls": live_calls,
        "mock_calls": mock_calls,
        "quota_limit": limit,
        "remaining_calls": max(0, limit - total_calls),
        "usage_percent": usage_percent,
        "avg_latency_ms": avg_latency_ms,
        "total_estimated_tokens": total_tokens,
        "by_subject": by_subject,
    }


def _compute_minio_storage_stats(limit_mb: float) -> Dict[str, Any]:
    """Thống kê dung lượng ảnh Snapshot trên MinIO (tự động đọc MinIO thực hoặc fallback ledger)."""
    total_bytes = sum(int(snap.get("size_bytes") or 0) for snap in in_memory_snapshots)
    total_objects = len(in_memory_snapshots)
    by_class: Dict[str, Dict[str, Any]] = {}
    by_format: Dict[str, int] = {}

    for snap in in_memory_snapshots:
        size = int(snap.get("size_bytes") or 0)
        tags = snap.get("tags") or {}
        cls_name = tags.get("class_name") or "Chưa phân lớp"
        fmt = (snap.get("image_format") or "webp").lower()
        by_format[fmt] = by_format.get(fmt, 0) + 1
        bucket = by_class.setdefault(cls_name, {"snapshots": 0, "bytes": 0})
        bucket["snapshots"] += 1
        bucket["bytes"] += size

    minio_live_connected = False
    live_bucket_objects = 0
    live_bucket_bytes = 0
    if HAS_MINIO:
        try:
            import urllib3
            from minio import Minio

            http_client = urllib3.PoolManager(
                timeout=urllib3.Timeout(connect=0.3, read=0.5),
                retries=False,
            )
            client = Minio(
                settings.MINIO_ENDPOINT,
                access_key=settings.MINIO_ACCESS_KEY,
                secret_key=settings.MINIO_SECRET_KEY,
                secure=settings.MINIO_SECURE,
                http_client=http_client,
            )
            if client.bucket_exists(settings.MINIO_BUCKET):
                minio_live_connected = True
                for obj in client.list_objects(settings.MINIO_BUCKET, recursive=True):
                    live_bucket_objects += 1
                    live_bucket_bytes += int(getattr(obj, "size", 0) or 0)
        except Exception:
            minio_live_connected = False

    if minio_live_connected and live_bucket_bytes > total_bytes:
        total_bytes = live_bucket_bytes
        total_objects = max(total_objects, live_bucket_objects)

    total_mb = round(total_bytes / (1024 * 1024), 4)
    total_kb = round(total_bytes / 1024, 2)
    usage_percent = round((total_mb / limit_mb) * 100, 2) if limit_mb > 0 else 0.0

    return {
        "bucket": settings.MINIO_BUCKET,
        "endpoint": settings.MINIO_ENDPOINT,
        "minio_live_connected": minio_live_connected,
        "storage_source": "minio_live" if minio_live_connected else "snapshot_ledger",
        "total_snapshots": total_objects,
        "total_bytes": total_bytes,
        "total_kb": total_kb,
        "total_mb": total_mb,
        "quota_limit_mb": limit_mb,
        "remaining_mb": round(max(0.0, limit_mb - total_mb), 4),
        "usage_percent": usage_percent,
        "by_class": by_class,
        "by_format": by_format,
    }


@router.post("/login", response_model=TokenResponse, summary="TF28528: Đăng nhập Quản trị viên (Admin Portal)")
async def admin_login(payload: AdminLoginRequest, request: Request):
    _ensure_default_admin()
    norm_email = payload.email.strip().lower()
    client_ip = get_client_ip(request)
    check_auth_rate_limit("admin_pw", norm_email, client_ip)

    matched = None
    for user in in_memory_users.values():
        if user.get("role") == "ADMIN" and (user.get("email") or "").lower() == norm_email:
            matched = user
            break

    if not matched or not verify_password(payload.password, matched.get("password_hash") or ""):
        record_auth_failure("admin_pw", norm_email, client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email hoặc mật khẩu Quản trị viên không đúng.",
        )

    if not matched.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản Quản trị viên đang bị tạm khóa.",
        )

    clear_auth_failures("admin_pw", norm_email, client_ip)
    return _issue_session_tokens(
        matched,
        remember_me=False,
        device_id="admin-web-portal",
        device_name="Admin Management Console",
    )


@router.get("/schools", summary="TF28528: Danh sách danh mục trường học")
async def list_schools(authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    items = [_serialize_school(s) for s in in_memory_schools.values()]
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"count": len(items), "items": items}


@router.post("/schools", status_code=status.HTTP_201_CREATED, summary="TF28528: Tạo mới trường học")
async def create_school(payload: SchoolCreateRequest, authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    norm_code = payload.code.strip().upper()
    for existing in in_memory_schools.values():
        if existing["code"].upper() == norm_code:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Mã trường '{norm_code}' đã tồn tại.",
            )

    now = datetime.now(timezone.utc).isoformat()
    school_id = f"sch_{uuid.uuid4().hex[:10]}"
    record = {
        "id": school_id,
        "code": norm_code,
        "name": payload.name.strip(),
        "level": payload.level,
        "address": (payload.address or "").strip() or None,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    in_memory_schools[school_id] = record
    return {"status": "created", "school": _serialize_school(record)}


@router.patch("/schools/{school_id}", summary="TF28528: Cập nhật thông tin trường học")
async def update_school(
    school_id: str,
    payload: SchoolUpdateRequest,
    authorization: Optional[str] = Header(default=None),
):
    require_admin(authorization)
    school = in_memory_schools.get(school_id)
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy trường học.")

    if payload.name is not None:
        school["name"] = payload.name.strip()
    if payload.level is not None:
        school["level"] = payload.level
    if payload.address is not None:
        school["address"] = payload.address.strip() or None
    if payload.is_active is not None:
        school["is_active"] = payload.is_active
    school["updated_at"] = datetime.now(timezone.utc).isoformat()
    return {"status": "updated", "school": _serialize_school(school)}


@router.delete("/schools/{school_id}", summary="TF28528: Xóa trường học khỏi danh mục")
async def delete_school(school_id: str, authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    school = in_memory_schools.pop(school_id, None)
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy trường học.")

    removed_classes = [
        cid for cid, cls in list(in_memory_classes.items()) if cls.get("school_id") == school_id
    ]
    removed_names = [
        in_memory_classes[cid].get("name", "") for cid in removed_classes if cid in in_memory_classes
    ]
    for cid in removed_classes:
        in_memory_classes.pop(cid, None)
    _revoke_orphan_class_permissions(removed_names)

    return {"status": "deleted", "school_id": school_id, "removed_classes": len(removed_classes)}


@router.get("/classes", summary="TF28528: Danh sách lớp học theo trường")
async def list_classes(
    school_id: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    require_admin(authorization)
    items = []
    for cls in in_memory_classes.values():
        if school_id and cls.get("school_id") != school_id:
            continue
        items.append(_serialize_class(cls))
    items.sort(key=lambda x: (x.get("grade", 0), x.get("name", "")))
    return {"count": len(items), "items": items}


@router.post("/classes", status_code=status.HTTP_201_CREATED, summary="TF28528: Tạo mới lớp học")
async def create_class(payload: ClassCreateRequest, authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    school = in_memory_schools.get(payload.school_id)
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trường học không tồn tại.")

    norm_name = _normalize_class_name(payload.name)
    academic_year = payload.academic_year.strip()
    for existing in in_memory_classes.values():
        if (
            existing["school_id"] == payload.school_id
            and _normalize_class_name(existing["name"]) == norm_name
            and existing["academic_year"] == academic_year
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Lớp '{norm_name}' năm học '{academic_year}' đã tồn tại trong trường này.",
            )

    teacher_id = payload.homeroom_teacher_id or None
    if teacher_id:
        teacher = in_memory_users.get(teacher_id)
        if not teacher or teacher.get("role") != "TEACHER":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Giáo viên chủ nhiệm không tồn tại.")

    room_id = (payload.room_id or "").strip() or f"room-{_slugify(school['code'])}-{_slugify(norm_name)}"
    now = datetime.now(timezone.utc).isoformat()
    class_id = f"cls_{uuid.uuid4().hex[:10]}"
    record = {
        "id": class_id,
        "school_id": payload.school_id,
        "name": norm_name,
        "grade": payload.grade,
        "academic_year": academic_year,
        "room_id": room_id,
        "homeroom_teacher_id": teacher_id,
        "created_at": now,
        "updated_at": now,
    }
    in_memory_classes[class_id] = record
    _sync_teacher_class_assignment(teacher_id, norm_name)
    return {"status": "created", "classroom": _serialize_class(record)}


@router.patch("/classes/{class_id}/assign-teacher", summary="TF28528: Phân công giáo viên chủ nhiệm cho lớp")
async def assign_teacher_to_class(
    class_id: str,
    payload: ClassAssignTeacherRequest,
    authorization: Optional[str] = Header(default=None),
):
    require_admin(authorization)
    classroom = in_memory_classes.get(class_id)
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy lớp học.")

    if payload.teacher_id:
        teacher = in_memory_users.get(payload.teacher_id)
        if not teacher or teacher.get("role") != "TEACHER":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy giáo viên.")
        _sync_teacher_class_assignment(payload.teacher_id, classroom["name"])

    classroom["homeroom_teacher_id"] = payload.teacher_id or None
    classroom["updated_at"] = datetime.now(timezone.utc).isoformat()
    return {"status": "updated", "classroom": _serialize_class(classroom)}


@router.delete("/classes/{class_id}", summary="TF28528: Xóa lớp học")
async def delete_class(class_id: str, authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    classroom = in_memory_classes.pop(class_id, None)
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy lớp học.")
    _revoke_orphan_class_permissions([classroom.get("name", "")])
    return {"status": "deleted", "class_id": class_id}


@router.get("/teachers", summary="TF28528: Danh sách tài khoản Giáo viên đã cấp")
async def list_teachers(
    school_id: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    require_admin(authorization)
    items = []
    for user in in_memory_users.values():
        if user.get("role") != "TEACHER":
            continue
        if school_id and user.get("school_id") != school_id:
            continue
        items.append(_serialize_teacher(user))
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"count": len(items), "items": items}


@router.post("/teachers", status_code=status.HTTP_201_CREATED, summary="TF28528: Admin cấp tài khoản Giáo viên")
async def provision_teacher(payload: TeacherProvisionRequest, authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    norm_email = payload.email.strip().lower()
    if "@" not in norm_email or "." not in norm_email.split("@")[-1]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Email giáo viên không đúng định dạng.",
        )

    norm_phone = _normalize_phone(payload.phone_number)
    if payload.school_id and payload.school_id not in in_memory_schools:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trường công tác không tồn tại.")

    for existing in in_memory_users.values():
        if (existing.get("email") or "").lower() == norm_email:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Email '{norm_email}' đã được cấp tài khoản.",
            )
        if existing.get("phone_number") == norm_phone:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Số điện thoại '{norm_phone}' đã được sử dụng.",
            )

    raw_password = payload.password or f"Gv@{secrets.token_urlsafe(6)}"
    generated_temp = payload.password is None
    assigned_classes = [_normalize_class_name(c) for c in payload.assigned_classes if (c or "").strip()]
    now = datetime.now(timezone.utc).isoformat()
    teacher_id = f"teacher_{uuid.uuid4().hex[:12]}"

    teacher_record = {
        "id": teacher_id,
        "full_name": payload.full_name.strip(),
        "email": norm_email,
        "phone_number": norm_phone,
        "role": "TEACHER",
        "password_hash": get_password_hash(raw_password),
        "school_id": payload.school_id,
        "school_level": None,
        "class_name": assigned_classes[0] if assigned_classes else None,
        "allowed_classes": assigned_classes,
        "student_code": None,
        "is_active": True,
        "provisioned_by": "ADMIN",
        "created_at": now,
        "updated_at": now,
    }
    in_memory_users[teacher_id] = teacher_record

    response: Dict[str, Any] = {
        "status": "created",
        "teacher": _serialize_teacher(teacher_record),
    }
    if generated_temp:
        response["temporary_password"] = raw_password
    return response


@router.patch("/teachers/{teacher_id}", summary="TF28528: Cập nhật trạng thái hoặc lớp phụ trách của Giáo viên")
async def update_teacher(
    teacher_id: str,
    payload: TeacherUpdateRequest,
    authorization: Optional[str] = Header(default=None),
):
    require_admin(authorization)
    teacher = in_memory_users.get(teacher_id)
    if not teacher or teacher.get("role") != "TEACHER":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản giáo viên.")

    if payload.full_name is not None:
        teacher["full_name"] = payload.full_name.strip()
    if payload.school_id is not None:
        if payload.school_id and payload.school_id not in in_memory_schools:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trường học không tồn tại.")
        teacher["school_id"] = payload.school_id or None
    if payload.assigned_classes is not None:
        teacher["allowed_classes"] = [_normalize_class_name(c) for c in payload.assigned_classes if (c or "").strip()]
        teacher["class_name"] = teacher["allowed_classes"][0] if teacher["allowed_classes"] else None
    if payload.is_active is not None:
        teacher["is_active"] = payload.is_active
        if not payload.is_active:
            _revoke_all_user_sessions(teacher_id)

    teacher["updated_at"] = datetime.now(timezone.utc).isoformat()
    return {"status": "updated", "teacher": _serialize_teacher(teacher)}


@router.get("/stats", summary="TF28528: Thống kê tổng quan, lượt gọi Gemini/Mathpix và dung lượng MinIO")
async def get_admin_stats(authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    gemini_stats = _summarize_ai_provider(
        in_memory_ai_usage_logs,
        "GEMINI",
        int(in_memory_ai_quotas["gemini_limit"]),
    )
    mathpix_stats = _summarize_ai_provider(
        in_memory_ai_usage_logs,
        "MATHPIX",
        int(in_memory_ai_quotas["mathpix_limit"]),
    )
    minio_stats = _compute_minio_storage_stats(float(in_memory_ai_quotas["minio_storage_limit_mb"]))

    teachers = [u for u in in_memory_users.values() if u.get("role") == "TEACHER"]
    students_parents = [u for u in in_memory_users.values() if u.get("role") in ("STUDENT", "PARENT")]
    max_percent = max(
        gemini_stats["usage_percent"],
        mathpix_stats["usage_percent"],
        minio_stats["usage_percent"],
    )
    if max_percent >= 95:
        alert_level = "CRITICAL"
    elif max_percent >= 80:
        alert_level = "WARNING"
    else:
        alert_level = "NORMAL"

    return {
        "summary": {
            "total_schools": len(in_memory_schools),
            "total_classes": len(in_memory_classes),
            "total_teachers": len(teachers),
            "active_teachers": sum(1 for t in teachers if t.get("is_active", True)),
            "total_students_parents": len(students_parents),
            "total_ai_calls": gemini_stats["total_calls"] + mathpix_stats["total_calls"],
            "alert_level": alert_level,
        },
        "quotas": dict(in_memory_ai_quotas),
        "ai_usage": {
            "gemini": gemini_stats,
            "mathpix": mathpix_stats,
            "recent_logs": in_memory_ai_usage_logs[:20],
        },
        "minio_storage": minio_stats,
    }


@router.put("/ai-quota", summary="TF28528: Cập nhật hạn mức cảnh báo Gemini, Mathpix và MinIO")
async def update_ai_quota(
    payload: AIQuotaUpdateRequest,
    authorization: Optional[str] = Header(default=None),
):
    require_admin(authorization)
    if payload.gemini_limit is not None:
        in_memory_ai_quotas["gemini_limit"] = payload.gemini_limit
    if payload.mathpix_limit is not None:
        in_memory_ai_quotas["mathpix_limit"] = payload.mathpix_limit
    if payload.minio_storage_limit_mb is not None:
        in_memory_ai_quotas["minio_storage_limit_mb"] = payload.minio_storage_limit_mb
    in_memory_ai_quotas["updated_at"] = datetime.now(timezone.utc).isoformat()
    return {"status": "updated", "quotas": dict(in_memory_ai_quotas)}


@router.post("/ai-usage/record", summary="TF28528: Ghi nhận thủ công lượt gọi AI (phục vụ kiểm thử hạn ngạch)")
async def admin_record_ai_usage(
    payload: RecordAIUsageRequest,
    authorization: Optional[str] = Header(default=None),
):
    require_admin(authorization)
    entry = record_ai_usage_event(
        provider=payload.provider,
        task_type=payload.task_type,
        subject=payload.subject,
        latency_ms=payload.latency_ms,
        is_mock=payload.is_mock,
        estimated_tokens=payload.estimated_tokens,
        session_id=payload.session_id,
        room_id=payload.room_id,
    )
    return {"status": "recorded", "entry": entry}
