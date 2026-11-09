import uuid
from datetime import datetime
from typing import List
from fastapi import APIRouter
from app.schemas.snapshot import (
    SaveSnapshotRequest,
    SnapshotOut,
    LectureReviewResponse,
)
from app.services import storage_service

router = APIRouter()

SNAPSHOT_DB: List[dict] = []


@router.post("/save", response_model=SnapshotOut, summary="Lưu ảnh chụp bảng (Snapshot) trước khi xóa")
async def save_snapshot(payload: SaveSnapshotRequest):
    image_url = storage_service.save_board_snapshot(payload.image_base64)

    snapshot_data = {
        "id": f"snap_{uuid.uuid4().hex[:8]}",
        "session_id": payload.session_id,
        "page_number": payload.page_number,
        "image_url": image_url,
        "thumbnail_url": image_url,
        "ai_transcription": payload.ai_transcription or "Toán học - Đồ thị hàm số bậc 2",
        "created_at": datetime.utcnow()
    }

    SNAPSHOT_DB.append(snapshot_data)
    return SnapshotOut(**snapshot_data)


@router.get("/review", response_model=LectureReviewResponse, summary="Học sinh xem lại bài giảng theo môn và ngày")
async def review_lecture(date: str = "2026-11-09", subject: str = "Toán Học"):
    sample_snapshots = [
        SnapshotOut(
            id="snap_sample_1",
            session_id="session_demo",
            page_number=1,
            image_url="/uploads/snapshots/snap_sample_1.webp",
            thumbnail_url="/uploads/snapshots/snap_sample_1.webp",
            ai_transcription="Định lý Viet và khảo sát hàm parabol y = ax^2 + bx + c",
            created_at=datetime.utcnow()
        )
    ]

    return LectureReviewResponse(
        date=date,
        subject_name=subject,
        classroom_name="Lớp 10A1",
        teacher_name="Thầy Nguyễn Tuấn Khang",
        snapshots=sample_snapshots
    )
