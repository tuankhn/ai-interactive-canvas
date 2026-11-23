from datetime import datetime, timezone
import logging
from typing import Optional
from fastapi import APIRouter, Header, HTTPException
from app.api.auth_router import assert_user_can_access_class, require_role
from app.api.session_router import store_snapshot_record_from_base64
from app.core.config import settings
from app.core.database import (
    in_memory_pages,
    in_memory_snapshots,
    synced_offline_ids,
    trim_in_memory_stores,
)
from app.schemas.canvas_schema import (
    OfflineSyncBatchRequest,
    OfflineSyncBatchResponse,
    OfflineSyncItemResult,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/offline-sync", tags=["Offline Mode & Auto Sync (TF28510)"])


@router.get("/status")
async def offline_sync_status():
    """Kiểm tra kết nối máy chủ để phục vụ chế độ Offline Mode và tự động đồng bộ."""
    return {
        "online": True,
        "service": "offline-sync",
        "server_time": datetime.now(timezone.utc).isoformat(),
        "synced_offline_count": len(synced_offline_ids),
        "total_snapshots": len(in_memory_snapshots),
    }


@router.post("/snapshots", response_model=OfflineSyncBatchResponse)
async def sync_offline_snapshots(
    payload: OfflineSyncBatchRequest,
    authorization: Optional[str] = Header(default=None),
):
    """
    Task TF28510: Nhận hàng loạt ảnh Snapshot được lưu tạm trong IndexedDB lúc mất mạng
    và tự đẩy lên MinIO + PostgreSQL khi thiết bị có mạng trở lại.
    Hỗ trợ idempotency qua client_sync_id để tránh lưu trùng khi mạng chập chờn.
    """
    user = require_role(authorization, "TEACHER", "ADMIN")
    teacher_override = user.get("full_name") if user else None
    results = []
    synced_count = 0
    duplicate_count = 0
    failed_count = 0
    pages_synced = 0

    for page in payload.pages:
        assert_user_can_access_class(user, requested_room_id=page.room_id)
        key = f"{page.room_id}:{page.session_id}"
        if key not in in_memory_pages:
            in_memory_pages[key] = {}
        in_memory_pages[key][page.page_number] = {
            "page_number": page.page_number,
            "canvas_json": page.canvas_json,
            "recognized_latex": page.recognized_latex,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "synced_from_offline": True,
        }
        pages_synced += 1

    for item in payload.items:
        assert_user_can_access_class(user, requested_class_name=item.class_name, requested_room_id=item.room_id)
        if len(item.image_base64 or "") > settings.MAX_SNAPSHOT_BASE64_CHARS:
            raise HTTPException(
                status_code=413,
                detail="Kích thước ảnh Snapshot trong lô đồng bộ vượt quá giới hạn cho phép.",
            )
        scoped_sync_key = f"{item.room_id}:{item.class_name}:{item.client_sync_id}"
        existing = synced_offline_ids.get(scoped_sync_key)
        if not existing:
            legacy = synced_offline_ids.get(item.client_sync_id)
            if legacy and legacy.get("room_id") == item.room_id and legacy.get("class_name") == item.class_name:
                existing = legacy

        if existing:
            duplicate_count += 1
            results.append(
                OfflineSyncItemResult(
                    client_sync_id=item.client_sync_id,
                    status="duplicate",
                    snapshot_id=existing["snapshot_id"],
                    image_url=existing["image_url"],
                )
            )
            continue

        try:
            synced_at = datetime.now(timezone.utc).isoformat()
            extra_fields = {
                "client_sync_id": item.client_sync_id,
                "synced_at": synced_at,
                "synced_from_offline": True,
            }
            if item.captured_at:
                extra_fields["captured_at"] = item.captured_at
            record = store_snapshot_record_from_base64(
                image_base64=item.image_base64,
                session_id=item.session_id,
                room_id=item.room_id,
                class_name=item.class_name,
                teacher_name=teacher_override or item.teacher_name,
                subject=item.subject,
                period_number=item.period_number,
                page_number=item.page_number,
                trigger_type=item.trigger_type,
                recognized_latex=item.recognized_latex or "",
                extra_tags={"synced_from_offline": True},
                extra_fields=extra_fields,
            )
            snap_id = record["id"]
            sync_meta = {
                "snapshot_id": snap_id,
                "image_url": record["image_url"],
                "room_id": item.room_id,
                "class_name": item.class_name,
                "synced_at": synced_at,
            }
            synced_offline_ids[scoped_sync_key] = sync_meta
            if item.client_sync_id not in synced_offline_ids:
                synced_offline_ids[item.client_sync_id] = sync_meta
            trim_in_memory_stores()
            synced_count += 1
            results.append(
                OfflineSyncItemResult(
                    client_sync_id=item.client_sync_id,
                    status="synced",
                    snapshot_id=snap_id,
                    image_url=record["image_url"],
                )
            )
        except Exception as exc:
            logger.warning("Lỗi đồng bộ offline snapshot (client_sync_id=%s): %s", item.client_sync_id, exc)
            failed_count += 1
            results.append(
                OfflineSyncItemResult(
                    client_sync_id=item.client_sync_id,
                    status="failed",
                    error="Không thể xử lý ảnh Snapshot trong lô đồng bộ.",
                )
            )

    overall = "completed" if failed_count == 0 else ("partial" if synced_count + duplicate_count > 0 else "failed")
    return OfflineSyncBatchResponse(
        status=overall,
        total_received=len(payload.items),
        synced_count=synced_count,
        duplicate_count=duplicate_count,
        failed_count=failed_count,
        pages_synced=pages_synced,
        results=results,
    )
