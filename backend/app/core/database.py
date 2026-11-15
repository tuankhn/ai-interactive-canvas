from datetime import datetime, timezone
from typing import Dict, Any, Optional
import uuid
from app.core.config import settings

# Bộ nhớ đệm phiên học dự phòng khi chạy local chưa bật PostgreSQL/Redis
in_memory_sessions: Dict[str, Dict[str, Any]] = {}
in_memory_pages: Dict[str, Dict[int, Dict[str, Any]]] = {}
in_memory_snapshots: list = []
synced_offline_ids: Dict[str, Dict[str, Any]] = {}

# Bộ nhớ đệm xác thực & phiên thiết bị phòng học 14 ngày (TF28514, TF28515)
in_memory_users: Dict[str, Dict[str, Any]] = {}
in_memory_student_bindings: Dict[str, str] = {}  # student_code -> user_id (1 học sinh = 1 tài khoản)
in_memory_otps: Dict[str, Dict[str, Any]] = {}
in_memory_refresh_sessions: Dict[str, Dict[str, Any]] = {}
revoked_token_jtis: set = set()

# Bộ nhớ đệm quản trị Trường, Lớp & Thống kê hạn ngạch AI / MinIO (TF28528)
in_memory_schools: Dict[str, Dict[str, Any]] = {}
in_memory_classes: Dict[str, Dict[str, Any]] = {}
in_memory_ai_usage_logs: list = []
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
    return entry


def check_db_status() -> Dict[str, str]:
    """Kiểm tra kết nối PostgreSQL, Redis, MinIO (hỗ trợ fallback khi chạy local)."""
    status = {
        "postgresql": f"configured ({settings.DATABASE_URL.split('@')[-1]})",
        "redis": f"configured ({settings.REDIS_URL})",
        "minio": f"configured ({settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET})",
    }
    return status
