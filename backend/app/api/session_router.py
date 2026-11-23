import base64
from datetime import datetime, timezone
from io import BytesIO
from typing import Dict, Optional
import uuid
from fastapi import APIRouter, Header, HTTPException, Query, Response
from PIL import Image, ImageDraw
from app.schemas.canvas_schema import PageSaveRequest, SnapshotSaveRequest
from app.core.config import settings
from app.core.database import (
    in_memory_pages,
    in_memory_snapshot_blobs,
    in_memory_snapshots,
    trim_in_memory_stores,
)
from app.core.storage import convert_canvas_to_highres, upload_snapshot_to_minio
from app.api.auth_router import (
    assert_user_can_access_class,
    get_current_user_from_header,
    require_role,
    verify_snapshot_signature,
)

router = APIRouter(prefix="/api/v1/sessions", tags=["Board Pages & Snapshots (MinIO + PostgreSQL)"])


async def save_board_page_core(payload: PageSaveRequest) -> dict:
    """Logic lõi lưu trạng thái trang bảng vẽ (gọi trực tiếp từ router hoặc benchmark)."""
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


@router.post("/pages")
@router.post("/page/save", include_in_schema=False)
@router.post("/pages/save", include_in_schema=False)
async def save_board_page(
    payload: PageSaveRequest,
    authorization: Optional[str] = Header(default=None),
):
    """Lưu trạng thái trang bảng vẽ theo session_id và room_id (FR-CAN-03, NFR-SCALE-01)."""
    user = require_role(authorization, "TEACHER", "ADMIN")
    assert_user_can_access_class(user, requested_room_id=payload.room_id)
    return await save_board_page_core(payload)


async def get_board_pages_core(room_id: str, session_id: str, user: Optional[dict] = None) -> dict:
    """Logic lõi lấy danh sách trang bảng học theo phòng và phiên."""
    assert_user_can_access_class(user, requested_room_id=room_id)
    key = f"{room_id}:{session_id}"
    pages = in_memory_pages.get(key, {})
    return {
        "room_id": room_id,
        "session_id": session_id,
        "pages": pages,
    }


@router.get("/pages/{room_id}/{session_id}")
async def get_board_pages(
    room_id: str,
    session_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """Lấy danh sách các trang bảng trong phiên học hiện tại (kiểm tra phân quyền lớp nếu là HS/PH)."""
    user = get_current_user_from_header(authorization, required=settings.AUTH_ENFORCE)
    return await get_board_pages_core(room_id=room_id, session_id=session_id, user=user)


def store_snapshot_record_from_base64(
    *,
    image_base64: str,
    session_id: str,
    room_id: str,
    class_name: str,
    teacher_name: str,
    subject: str,
    period_number: int,
    page_number: int,
    trigger_type: str,
    recognized_latex: str = "",
    ocr_text_metadata: Optional[str] = None,
    extra_tags: Optional[dict] = None,
    extra_fields: Optional[dict] = None,
) -> dict:
    """N14 + M7: Helper dùng chung dựng bản ghi Snapshot, lưu blob nhị phân và cắt tỉa kho in-memory."""
    storage_info = upload_snapshot_to_minio(
        image_base64=image_base64,
        class_name=class_name,
        subject=subject,
        image_format="webp",
    )
    snap_id = str(uuid.uuid4())
    date_str = ((extra_fields or {}).get("captured_at") or storage_info["created_at"])[:10]
    tags = {
        "teacher_name": teacher_name,
        "class_name": class_name,
        "subject": subject,
        "period_number": period_number,
        "page_number": page_number,
        "date": date_str,
        **(extra_tags or {}),
    }
    record = {
        "id": snap_id,
        "session_id": session_id,
        "room_id": room_id,
        "tags": tags,
        "trigger_type": trigger_type,
        "image_url": storage_info["image_url"],
        "preview_url": f"/api/v1/sessions/snapshots/{snap_id}/image?format={storage_info['image_format']}",
        "image_format": storage_info["image_format"],
        "size_bytes": storage_info["size_bytes"],
        "ocr_text_metadata": ocr_text_metadata if ocr_text_metadata is not None else (recognized_latex or ""),
        "recognized_latex": recognized_latex or "",
        "created_at": storage_info["created_at"],
        "retention_until": storage_info["retention_until"],
        **(extra_fields or {}),
    }
    if storage_info.get("data_uri") and "," in storage_info["data_uri"]:
        in_memory_snapshot_blobs[snap_id] = base64.b64decode(storage_info["data_uri"].split(",", 1)[1])
    else:
        in_memory_snapshot_blobs[snap_id] = convert_canvas_to_highres(image_base64, "webp")
    in_memory_snapshots.insert(0, record)
    trim_in_memory_stores()
    return record


async def save_snapshot_core(payload: SnapshotSaveRequest, teacher_name_override: Optional[str] = None) -> dict:
    """Logic lõi lưu ảnh Snapshot bảng học lên MinIO + kho metadata (tái sử dụng cho router & benchmark)."""
    if len(payload.image_base64 or "") > settings.MAX_SNAPSHOT_BASE64_CHARS:
        raise HTTPException(
            status_code=413,
            detail="Kích thước ảnh Snapshot vượt quá giới hạn cho phép.",
        )
    effective_teacher = teacher_name_override or payload.teacher_name
    try:
        record = store_snapshot_record_from_base64(
            image_base64=payload.image_base64,
            session_id=payload.session_id,
            room_id=payload.room_id,
            class_name=payload.class_name,
            teacher_name=effective_teacher,
            subject=payload.subject,
            period_number=payload.period_number,
            page_number=payload.page_number,
            trigger_type=payload.trigger_type,
            recognized_latex=payload.recognized_latex or "",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Không thể xử lý ảnh Snapshot định dạng Base64.") from exc

    return {
        "status": "saved",
        "snapshot_id": record["id"],
        "tags": record["tags"],
        "image_url": record["image_url"],
        "preview_url": record["preview_url"],
        "image_format": record["image_format"],
        "created_at": record["created_at"],
        "retention_until": record["retention_until"],
        "total_snapshots": len(in_memory_snapshots),
    }


@router.post("/snapshots")
@router.post("/snapshot", include_in_schema=False)
@router.post("/snapshot/save", include_in_schema=False)
@router.post("/snapshots/save", include_in_schema=False)
async def save_snapshot(
    payload: SnapshotSaveRequest,
    authorization: Optional[str] = Header(default=None),
):
    """
    Task TF2850E: Xuất ảnh bảng độ phân giải cao (.webp/.png) lưu vào MinIO khi bấm Lưu bài hoặc Xóa bảng.
    Tự động gắn thẻ giáo viên, lớp, môn, ngày giờ, tiết học và lưu nội dung OCR vào DB để tìm kiếm (lưu tối thiểu 6 tháng).
    """
    user = require_role(authorization, "TEACHER", "ADMIN")
    assert_user_can_access_class(user, requested_class_name=payload.class_name, requested_room_id=payload.room_id)
    teacher_override = user.get("full_name") if user else None
    return await save_snapshot_core(payload, teacher_name_override=teacher_override)


def _render_fallback_snapshot_bytes(record: dict) -> bytes:
    """Sinh ảnh bảng học độ nét cao dự phòng khi snapshot chưa có blob nhị phân trên local."""
    img = Image.new("RGB", (960, 540), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    tags = record.get("tags") or {}
    draw.rectangle([(16, 16), (944, 524)], outline=(34, 47, 113), width=4)
    draw.text((40, 40), f"Lop: {tags.get('class_name', '10A1')} | Mon: {tags.get('subject', 'TOAN')}", fill=(34, 47, 113))
    draw.text((40, 80), f"Giao vien: {tags.get('teacher_name', 'Giao vien')} | Ngay: {tags.get('date', '')}", fill=(71, 85, 105))
    latex = (record.get("recognized_latex") or record.get("ocr_text_metadata") or "Noi dung bang hoc")[:120]
    draw.text((40, 150), latex, fill=(15, 23, 42))
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


@router.get("/snapshots/{snapshot_id}/image", summary="TF2851F: Xem & Tải ảnh bảng độ nét cao (PNG/WebP)")
async def get_snapshot_image(
    snapshot_id: str,
    format: str = Query(default="webp", description="Định dạng ảnh trả về: webp hoặc png"),
    download: bool = Query(default=False, description="Bật true để tải file về máy"),
    exp: Optional[int] = Query(default=None, description="Thời điểm hết hạn chữ ký URL ngắn hạn"),
    sig: Optional[str] = Query(default=None, description="Chữ ký HMAC ngắn hạn của ảnh bài học"),
    token: Optional[str] = Query(default=None, description="JWT tương thích ngược"),
    authorization: Optional[str] = Header(default=None),
):
    snap = next((item for item in in_memory_snapshots if item.get("id") == snapshot_id), None)
    if not snap:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh bài học.")

    exp_val = exp if isinstance(exp, int) else None
    sig_val = sig if isinstance(sig, str) else None
    tok_val = token if isinstance(token, str) else None
    signed_ok = verify_snapshot_signature(snapshot_id, exp_val, sig_val)
    if not signed_ok:
        auth_header = authorization if isinstance(authorization, str) else None
        if not auth_header and tok_val:
            auth_header = f"Bearer {tok_val}"
        user = get_current_user_from_header(auth_header, required=settings.AUTH_ENFORCE)
        assert_user_can_access_class(user, requested_class_name=snap.get("tags", {}).get("class_name"))

    raw_bytes = in_memory_snapshot_blobs.get(snapshot_id) or _render_fallback_snapshot_bytes(snap)
    ext = "png" if format.lower() == "png" else "webp"
    pil_fmt = "PNG" if ext == "png" else "WEBP"

    img = Image.open(BytesIO(raw_bytes))
    out = BytesIO()
    if pil_fmt == "PNG":
        img.save(out, format="PNG", optimize=True)
    else:
        img.save(out, format="WEBP", quality=92, method=4)

    tags = snap.get("tags") or {}
    filename = f"bai-hoc-{tags.get('class_name', 'lop')}-{tags.get('subject', 'mon')}-{tags.get('date', 'today')}.{ext}"
    disposition = "attachment" if download else "inline"
    return Response(
        content=out.getvalue(),
        media_type=f"image/{ext}",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "private, max-age=300",
        },
    )


async def list_snapshots_core(
    *,
    class_name: Optional[str] = None,
    subject: Optional[str] = None,
    date: Optional[str] = None,
    room_id: Optional[str] = None,
    session_id: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 24,
    offset: int = 0,
    user: Optional[dict] = None,
) -> dict:
    """Logic lõi lọc danh sách Snapshot bài học."""
    resolved_class_name = class_name if isinstance(class_name, str) else None
    resolved_room_id = room_id if isinstance(room_id, str) else None
    assert_user_can_access_class(
        user,
        requested_class_name=resolved_class_name,
        requested_room_id=resolved_room_id,
    )

    results = in_memory_snapshots
    if user and (
        user.get("role") in ("STUDENT", "PARENT")
        or (settings.AUTH_ENFORCE and user.get("role") == "TEACHER")
    ):
        allowed = set(user.get("allowed_classes") or [])
        if "*" not in allowed:
            results = [r for r in results if r["tags"]["class_name"].replace(" ", "").upper() in allowed]
    if resolved_class_name:
        results = [r for r in results if r["tags"]["class_name"].lower() == resolved_class_name.lower()]
    if room_id and isinstance(room_id, str):
        results = [r for r in results if r.get("room_id") == room_id]
    if session_id and isinstance(session_id, str):
        results = [r for r in results if r.get("session_id") == session_id]

    calendar_counts: Dict[str, int] = {}
    for item in results:
        d = item.get("tags", {}).get("date")
        if d:
            calendar_counts[d] = calendar_counts.get(d, 0) + 1

    if subject and isinstance(subject, str):
        results = [r for r in results if r["tags"]["subject"].lower() == subject.lower()]
    if date and isinstance(date, str):
        results = [r for r in results if r["tags"]["date"] == date]
    if q and isinstance(q, str):
        q_low = q.lower()
        results = [
            r for r in results
            if q_low in (r.get("ocr_text_metadata") or "").lower()
            or q_low in (r.get("recognized_latex") or "").lower()
        ]
    offset_val = offset if isinstance(offset, int) else 0
    limit_val = limit if isinstance(limit, int) else 24
    total_count = len(results)
    paged = results[offset_val:offset_val + limit_val]
    return {
        "count": len(paged),
        "total_count": total_count,
        "calendar_counts": calendar_counts,
        "items": paged,
    }


@router.get("/snapshots")
async def list_snapshots(
    class_name: Optional[str] = Query(default=None, description="Lọc theo tên lớp (vd: 10A1)"),
    subject: Optional[str] = Query(default=None, description="Lọc theo môn học (vd: TOAN)"),
    date: Optional[str] = Query(default=None, description="Lọc theo ngày YYYY-MM-DD"),
    room_id: Optional[str] = Query(default=None, description="Lọc theo phòng học (vd: room-10a1)"),
    session_id: Optional[str] = Query(default=None, description="Lọc theo phiên học"),
    q: Optional[str] = Query(default=None, description="Tìm kiếm theo nội dung văn bản OCR / LaTeX"),
    limit: int = Query(default=24, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    authorization: Optional[str] = Header(default=None),
):
    """Truy vấn và tìm kiếm danh sách Snapshot theo lớp, môn học, ngày học, phòng học và nội dung OCR."""
    user = get_current_user_from_header(authorization, required=settings.AUTH_ENFORCE)
    return await list_snapshots_core(
        class_name=class_name,
        subject=subject,
        date=date,
        room_id=room_id,
        session_id=session_id,
        q=q,
        limit=limit,
        offset=offset,
        user=user,
    )


# Router tương thích cho tiền tố số ít /api/v1/session
alias_router = APIRouter(prefix="/api/v1/session", tags=["Session Alias"], include_in_schema=False)
alias_router.add_api_route("/pages", save_board_page, methods=["POST"])
alias_router.add_api_route("/page/save", save_board_page, methods=["POST"])
alias_router.add_api_route("/pages/save", save_board_page, methods=["POST"])
alias_router.add_api_route("/snapshots", save_snapshot, methods=["POST"])
alias_router.add_api_route("/snapshot", save_snapshot, methods=["POST"])
alias_router.add_api_route("/snapshot/save", save_snapshot, methods=["POST"])
alias_router.add_api_route("/snapshots/save", save_snapshot, methods=["POST"])
