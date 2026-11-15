from typing import List, Literal, Optional
from pydantic import BaseModel, Field


SchoolLevel = Literal["TIEU_HOC", "THCS", "THPT", "LIEN_CAP"]
AIProviderGroup = Literal["GEMINI", "MATHPIX"]


class AdminLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=150, description="Email Quản trị viên")
    password: str = Field(..., min_length=4, max_length=128, description="Mật khẩu Quản trị viên")


class SchoolCreateRequest(BaseModel):
    code: str = Field(..., min_length=2, max_length=50, description="Mã trường duy nhất (vd: THPT-LHP)")
    name: str = Field(..., min_length=3, max_length=255, description="Tên đầy đủ của trường")
    level: SchoolLevel = Field(default="THPT", description="Cấp học (TIEU_HOC, THCS, THPT, LIEN_CAP)")
    address: Optional[str] = Field(default=None, max_length=500, description="Địa chỉ trường học")


class SchoolUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=255)
    level: Optional[SchoolLevel] = None
    address: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None


class ClassCreateRequest(BaseModel):
    school_id: str = Field(..., min_length=2, description="ID trường học quản lý lớp")
    name: str = Field(..., min_length=1, max_length=50, description="Tên lớp (vd: 10A1, 5B)")
    grade: int = Field(..., ge=1, le=12, description="Khối lớp (từ 1 đến 12)")
    academic_year: str = Field(default="2026-2027", min_length=4, max_length=20, description="Năm học")
    room_id: Optional[str] = Field(default=None, max_length=100, description="Mã phòng học thiết bị bảng thông minh")
    homeroom_teacher_id: Optional[str] = Field(default=None, description="ID giáo viên chủ nhiệm")


class ClassAssignTeacherRequest(BaseModel):
    teacher_id: Optional[str] = Field(default=None, description="ID giáo viên được phân công (null để gỡ phân công)")


class TeacherProvisionRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150, description="Họ và tên giáo viên")
    email: str = Field(..., min_length=5, max_length=150, description="Email công vụ để đăng nhập/nhận OTP")
    phone_number: str = Field(..., min_length=9, max_length=20, description="Số điện thoại giáo viên")
    password: Optional[str] = Field(
        default=None,
        min_length=6,
        max_length=128,
        description="Mật khẩu khởi tạo (nếu bỏ trống hệ thống tự sinh mật khẩu tạm thời)",
    )
    school_id: Optional[str] = Field(default=None, description="ID trường công tác")
    assigned_classes: List[str] = Field(default_factory=list, description="Danh sách lớp giáo viên phụ trách")


class TeacherUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    school_id: Optional[str] = Field(default=None)
    assigned_classes: Optional[List[str]] = None
    is_active: Optional[bool] = None


class AIQuotaUpdateRequest(BaseModel):
    gemini_limit: Optional[int] = Field(default=None, ge=1, le=10_000_000)
    mathpix_limit: Optional[int] = Field(default=None, ge=1, le=10_000_000)
    minio_storage_limit_mb: Optional[float] = Field(default=None, gt=0, le=10_000_000)


class RecordAIUsageRequest(BaseModel):
    provider: AIProviderGroup = Field(default="GEMINI")
    task_type: str = Field(default="OCR_LATEX", max_length=40)
    subject: str = Field(default="TOAN", max_length=40)
    latency_ms: int = Field(default=320, ge=0, le=120_000)
    is_mock: bool = Field(default=False)
    estimated_tokens: int = Field(default=250, ge=0, le=1_000_000)
    session_id: Optional[str] = None
    room_id: Optional[str] = None
