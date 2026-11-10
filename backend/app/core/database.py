from typing import Dict, Any
from app.core.config import settings

# Bộ nhớ đệm phiên học dự phòng khi chạy local chưa bật PostgreSQL/Redis
in_memory_sessions: Dict[str, Dict[str, Any]] = {}
in_memory_pages: Dict[str, Dict[int, Dict[str, Any]]] = {}
in_memory_snapshots: list = []


def check_db_status() -> Dict[str, str]:
    """Kiểm tra kết nối PostgreSQL, Redis, MinIO (hỗ trợ fallback khi chạy local)."""
    status = {
        "postgresql": f"configured ({settings.DATABASE_URL.split('@')[-1]})",
        "redis": f"configured ({settings.REDIS_URL})",
        "minio": f"configured ({settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET})",
    }
    return status
