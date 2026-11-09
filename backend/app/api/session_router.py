from datetime import datetime, timezone
from typing import Optional
import uuid
from fastapi import APIRouter, HTTPException, Query
from app.schemas.canvas_schema import PageSaveRequest, SnapshotSaveRequest
from app.core.database import in_memory_pages, in_memory_snapshots
from app.core.storage import upload_snapshot_to_minio

router = APIRouter(prefix="/api/v1/sessions", tags=["Board Pages & Snapshots (MinIO + PostgreSQL)"])


@router.post("/pages")
async def save_board_page(payload: PageSaveRequest):
    """Lưu trạng thái trang bảng vẽ theo session_id và room_id (FR-CAN-03, NFR-SCALE-01)."""
    key = f"{payload.room_id}:{payload.session_id}"
    if key not in in_memory_pages:
        in_memory_pages[key] = {}
    in_memory_pages[key][payload.page_number] = {
        "page_number": payload.page_number,
        "canvas_json": payload.canvas_json,
        "recognized_latex": payload.recognized_latex,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    return {
        "status": "ok",
        "session_key": key,
        "page_number": payload.page_number,
        "total_pages": len(in_memory_pages[key]),
    }


@router.get("/pages/{room_id}/{session_id}")
async def get_board_pages(room_id: str, session_id: str):
    """Lấy danh sách các trang bảng trong phiên học hiện tại."""
    key = f"{room_id}:{session_id}"
    pages = in_memory_pages.get(key, {})
    return {
        "room_id": room_id,
        "session_id": session_id,
        "pages": pages,
    }


@router.post("/snapshots")
async def save_snapshot(payload: SnapshotSaveRequest):
    """
    Task TF2850E: Xuất ảnh bảng độ phân giải cao (.webp/.png) lưu vào MinIO khi bấm Lưu bài hoặc Xóa bảng.
    Tự động gắn thẻ giáo viên, lớp, môn, ngày giờ, tiết học và lưu nội dung OCR vào DB để tìm kiếm (lưu tối thiểu 6 tháng).
    """
    try:
        storage_info = upload_snapshot_to_minio(
            image_base64=payload.image_base64,
            class_name=payload.class_name,
            subject=payload.subject,
            image_format="webp",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Không thể xử lý ảnh Snapshot: {exc}") from exc

    snap_id = str(uuid.uuid4())
    tags = {
        "teacher_name": payload.teacher_name,
        "class_name": payload.class_name,
        "subject": payload.subject,
        "period_number": payload.period_number,
        "page_number": payload.page_number,
        "date": storage_info["created_at"][:10],
    }

    record = {
        "id": snap_id,
        "session_id": payload.session_id,
        "room_id": payload.room_id,
        "tags": tags,
        "trigger_type": payload.trigger_type,
        "image_url": storage_info["image_url"],
        "image_format": storage_info["image_format"],
        "size_bytes": storage_info["size_bytes"],
        "ocr_text_metadata": payload.recognized_latex or "",
        "recognized_latex": payload.recognized_latex or "",
        "created_at": storage_info["created_at"],
        "retention_until": storage_info["retention_until"],
    }
    in_memory_snapshots.insert(0, record)
    return {
        "status": "saved",
        "snapshot_id": snap_id,
        "tags": tags,
        "image_url": record["image_url"],
        "image_format": record["image_format"],
        "created_at": record["created_at"],
        "retention_until": record["retention_until"],
        "total_snapshots": len(in_memory_snapshots),
    }


@router.get("/snapshots")
async def list_snapshots(
    class_name: Optional[str] = Query(default=None, description="Lọc theo tên lớp (vd: 10A1)"),
    subject: Optional[str] = Query(default=None, description="Lọc theo môn học (vd: TOAN)"),
    date: Optional[str] = Query(default=None, description="Lọc theo ngày YYYY-MM-DD"),
    q: Optional[str] = Query(default=None, description="Tìm kiếm theo nội dung văn bản OCR / LaTeX"),
):
    """Truy vấn và tìm kiếm danh sách Snapshot theo lớp, môn học, ngày học và nội dung OCR."""
    results = in_memory_snapshots
    if class_name:
        results = [r for r in results if r["tags"]["class_name"].lower() == class_name.lower()]
    if subject:
        results = [r for r in results if r["tags"]["subject"].lower() == subject.lower()]
    if date:
        results = [r for r in results if r["tags"]["date"] == date]
    if q:
        q_low = q.lower()
        results = [
            r for r in results
            if q_low in (r.get("ocr_text_metadata") or "").lower()
            or q_low in (r.get("recognized_latex") or "").lower()
        ]
    return {"count": len(results), "items": results}
