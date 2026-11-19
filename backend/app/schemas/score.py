from typing import List, Optional
from pydantic import BaseModel, Field


class StudentRosterCreateRequest(BaseModel):
    class_name: str = Field(..., min_length=1, max_length=50, description="Tên lớp học (vd: 10A1)")
    full_name: str = Field(..., min_length=2, max_length=150, description="Họ và tên học sinh")
    student_code: Optional[str] = Field(default=None, max_length=50, description="Mã định danh học sinh")


class BonusPointAwardRequest(BaseModel):
    class_name: str = Field(default="10A1", min_length=1, max_length=50)
    session_id: str = Field(default="session-10a1", min_length=1, max_length=100)
    room_id: str = Field(default="room-10a1", min_length=1, max_length=100)
    student_id: str = Field(..., min_length=1, max_length=100)
    student_name: Optional[str] = Field(default=None, max_length=150)
    teacher_name: str = Field(default="Giáo viên", max_length=150)
    subject: str = Field(default="TOAN", max_length=50)
    period_number: int = Field(default=1, ge=1, le=12)
    page_number: int = Field(default=1, ge=1)
    points_added: float = Field(default=1.0, gt=0, le=20, description="Số điểm thưởng (+1, +2, +3...)")
    reason: str = Field(default="Làm bài tốt trên bảng", max_length=255)
    image_base64: Optional[str] = Field(default=None, description="Ảnh chụp nhanh bài làm trên bảng để lưu kèm DB/MinIO")
    snapshot_id: Optional[str] = Field(default=None, description="ID snapshot có sẵn nếu không gửi ảnh mới")


class StudentScoreSummary(BaseModel):
    student_id: str
    full_name: str
    student_code: Optional[str] = None
    class_name: str
    total_points: float = 0.0
    award_count: int = 0


class BonusScoreLogOut(BaseModel):
    id: str
    student_id: str
    student_name: str
    student_code: Optional[str] = None
    class_name: str
    session_id: str
    room_id: str
    teacher_name: str
    subject: str
    points_added: float
    total_points: float
    reason: str
    snapshot_id: Optional[str] = None
    snapshot_url: Optional[str] = None
    created_at: str


class BonusPointAwardResponse(BaseModel):
    status: str = "awarded"
    record: BonusScoreLogOut
    total_points: float
    snapshot_saved: bool = False


class StudentScoreListResponse(BaseModel):
    class_name: str
    count: int
    items: List[StudentScoreSummary]
