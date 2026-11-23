from datetime import datetime, timezone
from typing import Dict, Any, Optional
import uuid
from sqlalchemy.orm import declarative_base
from app.core.config import settings

# Base ORM cho các model SQLAlchemy trong backend/app/models/*
Base = declarative_base()

# Bộ nhớ đệm phiên học dự phòng khi chạy local chưa bật PostgreSQL/Redis
in_memory_sessions: Dict[str, Dict[str, Any]] = {}
in_memory_pages: Dict[str, Dict[int, Dict[str, Any]]] = {}
in_memory_snapshots: list = []
in_memory_snapshot_blobs: Dict[str, bytes] = {}
in_memory_exam_answer_keys: Dict[str, Dict[str, Any]] = {}
synced_offline_ids: Dict[str, Dict[str, Any]] = {}

# Bộ nhớ đệm xác thực & phiên thiết bị phòng học 14 ngày (TF28514, TF28515)
in_memory_users: Dict[str, Dict[str, Any]] = {}
in_memory_student_bindings: Dict[str, str] = {}  # student_code -> user_id (1 học sinh = 1 tài khoản)
in_memory_otps: Dict[str, Dict[str, Any]] = {}
in_memory_refresh_sessions: Dict[str, Dict[str, Any]] = {}
revoked_token_jtis: set = set()
in_memory_login_failures: Dict[str, Dict[str, Any]] = {}
in_memory_otp_cooldowns: Dict[str, float] = {}

# Bộ nhớ đệm quản trị Trường, Lớp & Thống kê hạn ngạch AI / MinIO (TF28528)
in_memory_schools: Dict[str, Dict[str, Any]] = {}
in_memory_classes: Dict[str, Dict[str, Any]] = {}
in_memory_ai_usage_logs: list = []
in_memory_circle_submissions: list = []
in_memory_score_logs: list = []
in_memory_class_rosters: Dict[str, Any] = {}
in_memory_ai_quotas: Dict[str, Any] = {
    "gemini_limit": settings.GEMINI_MONTHLY_QUOTA,
    "mathpix_limit": settings.MATHPIX_MONTHLY_QUOTA,
    "minio_storage_limit_mb": settings.MINIO_STORAGE_QUOTA_MB,
    "updated_at": None,
}


def record_ai_usage_event(
    *,
    provider: str,
    task_type: str = "OCR_LATEX",
    subject: str = "TOAN",
    latency_ms: int = 0,
    is_mock: bool = False,
    estimated_tokens: int = 250,
    session_id: Optional[str] = None,
    room_id: Optional[str] = None,
    provider_detail: Optional[str] = None,
) -> Dict[str, Any]:
    """Ghi nhận một lượt gọi AI (Gemini / Mathpix) phục vụ thống kê hạn ngạch trang Admin."""
    norm_provider = (provider or "GEMINI").strip().upper()
    if "MATHPIX" in norm_provider:
        provider_group = "MATHPIX"
    else:
        provider_group = "GEMINI"

    entry = {
        "id": str(uuid.uuid4()),
        "provider": provider_group,
        "provider_detail": provider_detail or provider or provider_group,
        "task_type": (task_type or "OCR_LATEX").upper(),
        "subject": (subject or "TOAN").upper(),
        "session_id": session_id,
        "room_id": room_id,
        "latency_ms": max(0, int(latency_ms or 0)),
        "is_mock": bool(is_mock),
        "estimated_tokens": max(0, int(estimated_tokens or 0)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    in_memory_ai_usage_logs.insert(0, entry)
    trim_in_memory_stores()
    return entry


def trim_in_memory_stores() -> None:
    """M7: Giới hạn kích thước các kho in-memory & thu dọn mục quá hạn tránh tăng trưởng không giới hạn."""
    max_snaps = max(10, int(getattr(settings, "MAX_IN_MEMORY_SNAPSHOTS", 500)))
    if len(in_memory_snapshots) > max_snaps:
        evicted = in_memory_snapshots[max_snaps:]
        del in_memory_snapshots[max_snaps:]
        for item in evicted:
            sid = item.get("id")
            if sid:
                in_memory_snapshot_blobs.pop(sid, None)

    max_keys = max(50, int(getattr(settings, "MAX_IN_MEMORY_ANSWER_KEYS", 2000)))
    while len(in_memory_exam_answer_keys) > max_keys:
        oldest_qid = next(iter(in_memory_exam_answer_keys))
        in_memory_exam_answer_keys.pop(oldest_qid, None)

    max_logs = max(50, int(getattr(settings, "MAX_IN_MEMORY_LOGS", 2000)))
    if len(in_memory_ai_usage_logs) > max_logs:
        del in_memory_ai_usage_logs[max_logs:]
    if len(in_memory_score_logs) > max_logs:
        del in_memory_score_logs[max_logs:]
    if len(in_memory_circle_submissions) > max_logs:
        del in_memory_circle_submissions[max_logs:]

    while len(synced_offline_ids) > max_logs:
        oldest_sync = next(iter(synced_offline_ids))
        synced_offline_ids.pop(oldest_sync, None)

    if len(in_memory_otps) > max_logs:
        now_dt = datetime.now(timezone.utc)
        expired_keys = [
            k
            for k, v in list(in_memory_otps.items())
            if v.get("verified") or datetime.fromisoformat(v["expires_at"]) < now_dt
        ]
        for k in expired_keys:
            in_memory_otps.pop(k, None)


def check_db_status() -> Dict[str, str]:
    """Kiểm tra kết nối PostgreSQL, Redis, MinIO (hỗ trợ fallback khi chạy local)."""
    status = {
        "postgresql": f"configured ({settings.DATABASE_URL.split('@')[-1]})",
        "redis": f"configured ({settings.REDIS_URL})",
        "minio": f"configured ({settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET})",
    }
    return status
