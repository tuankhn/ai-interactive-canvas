from datetime import datetime, timezone
import uuid
from fastapi import APIRouter
from app.core.database import in_memory_pages, in_memory_snapshots, synced_offline_ids
from app.core.storage import upload_snapshot_to_minio
from app.schemas.canvas_schema import (
    OfflineSyncBatchRequest,
    OfflineSyncBatchResponse,
    OfflineSyncItemResult,
)

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
async def sync_offline_snapshots(payload: OfflineSyncBatchRequest):
    """
    Task TF28510: Nhận hàng loạt ảnh Snapshot được lưu tạm trong IndexedDB lúc mất mạng
    và tự đẩy lên MinIO + PostgreSQL khi thiết bị có mạng trở lại.
    Hỗ trợ idempotency qua client_sync_id để tránh lưu trùng khi mạng chập chờn.
    """
    results = []
    synced_count = 0
    duplicate_count = 0
    failed_count = 0
    pages_synced = 0

    for page in payload.pages:
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
        existing = synced_offline_ids.get(item.client_sync_id)
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
            storage_info = upload_snapshot_to_minio(
                image_base64=item.image_base64,
                class_name=item.class_name,
                subject=item.subject,
                image_format="webp",
            )
            snap_id = str(uuid.uuid4())
            synced_at = datetime.now(timezone.utc).isoformat()
            captured_at = item.captured_at or storage_info["created_at"]
            tags = {
                "teacher_name": item.teacher_name,
                "class_name": item.class_name,
                "subject": item.subject,
                "period_number": item.period_number,
                "page_number": item.page_number,
                "date": captured_at[:10],
                "synced_from_offline": True,
            }
            record = {
                "id": snap_id,
                "client_sync_id": item.client_sync_id,
                "session_id": item.session_id,
                "room_id": item.room_id,
                "tags": tags,
                "trigger_type": item.trigger_type,
                "image_url": storage_info["image_url"],
                "image_format": storage_info["image_format"],
                "size_bytes": storage_info["size_bytes"],
                "ocr_text_metadata": item.recognized_latex or "",
                "recognized_latex": item.recognized_latex or "",
                "captured_at": captured_at,
                "synced_at": synced_at,
                "created_at": storage_info["created_at"],
                "retention_until": storage_info["retention_until"],
                "synced_from_offline": True,
            }
            in_memory_snapshots.insert(0, record)
            synced_offline_ids[item.client_sync_id] = {
                "snapshot_id": snap_id,
                "image_url": record["image_url"],
                "synced_at": synced_at,
            }
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
            failed_count += 1
            results.append(
                OfflineSyncItemResult(
                    client_sync_id=item.client_sync_id,
                    status="failed",
                    error=str(exc),
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
