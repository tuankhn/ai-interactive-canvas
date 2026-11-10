from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class SaveSnapshotRequest(BaseModel):
    session_id: str
    page_number: int = 1
    image_base64: str  # Base64 image captured from canvas
    ai_transcription: Optional[str] = None


class SnapshotOut(BaseModel):
    id: str
    session_id: str
    page_number: int
    image_url: str
    thumbnail_url: Optional[str]
    ai_transcription: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class LectureReviewResponse(BaseModel):
    date: str
    subject_name: str
    classroom_name: str
    teacher_name: str
    snapshots: List[SnapshotOut]
