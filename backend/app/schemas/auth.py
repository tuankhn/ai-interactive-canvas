from typing import List, Optional
from pydantic import BaseModel, EmailStr, ConfigDict, Field


class RequestOTPRequest(BaseModel):
    email: Optional[EmailStr] = None
    phone_number: str
    role: str = "TEACHER"  # TEACHER, STUDENT, PARENT
    full_name: Optional[str] = None


class VerifyOTPRequest(BaseModel):
    email: Optional[EmailStr] = None
    phone_number: str
    otp_code: str = Field(..., min_length=4, max_length=10)
    remember_me: bool = True  # Duy trì đăng nhập 14 ngày trên thiết bị phòng học
    device_id: Optional[str] = Field(default="smartboard-room-default", description="Mã thiết bị phòng học")
    device_name: Optional[str] = Field(default="Bảng thông minh phòng học", description="Tên thiết bị phòng học")
    full_name: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=6, description="Mật khẩu tùy chọn (băm Argon2/BCrypt)")


class TeacherRegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone_number: str = Field(..., min_length=9, max_length=20)
    password: str = Field(..., min_length=6, max_length=128)


class TeacherPasswordLoginRequest(BaseModel):
    email: Optional[EmailStr] = None
    phone_number: Optional[str] = None
    password: str = Field(..., min_length=1)
    remember_me: bool = True
    device_id: Optional[str] = "smartboard-room-default"
    device_name: Optional[str] = "Bảng thông minh phòng học"


class StudentParentRegisterRequest(BaseModel):
    """TF28515: Đăng ký SĐT học sinh (THCS/THPT) hoặc SĐT phụ huynh (Tiểu học), mỗi học sinh 1 tài khoản."""
    full_name: str = Field(..., min_length=2, max_length=150, description="Họ tên học sinh (hoặc phụ huynh đại diện)")
    phone_number: str = Field(..., min_length=9, max_length=20, description="SĐT học sinh (THCS/THPT) hoặc SĐT phụ huynh (Tiểu học)")
    password: str = Field(..., min_length=6, max_length=128)
    school_level: str = Field(..., description="Cấp học: TIEU_HOC, THCS, THPT")
    class_name: str = Field(..., min_length=1, max_length=50, description="Lớp học được phép xem bài (vd: 10A1, 5B)")
    student_code: str = Field(..., min_length=2, max_length=50, description="Mã định danh học sinh duy nhất")
    role: Optional[str] = Field(default=None, description="STUDENT (THCS/THPT) hoặc PARENT (Tiểu học)")


class StudentParentLoginRequest(BaseModel):
    phone_number: str = Field(..., min_length=9, max_length=20)
    password: str = Field(..., min_length=1)
    remember_me: bool = True
    device_id: Optional[str] = "home-portal-device"
    device_name: Optional[str] = "Cổng ôn tập tại nhà"


class ForgotPasswordOTPRequest(BaseModel):
    phone_number: str = Field(..., min_length=9, max_length=20)


class ResetPasswordOTPRequest(BaseModel):
    phone_number: str = Field(..., min_length=9, max_length=20)
    otp_code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=6, max_length=128)


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., min_length=10)
    device_id: Optional[str] = None


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None
    revoke_all_devices: bool = False


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_expires_in: int = 14 * 86400
    remember_days: int = 14
    user_id: str
    role: str
    full_name: str
    email: Optional[str] = None
    phone_number: Optional[str] = None
    device_id: Optional[str] = None
    password_hash_scheme: Optional[str] = None
    school_level: Optional[str] = None
    class_name: Optional[str] = None
    allowed_classes: List[str] = Field(default_factory=list)
    student_code: Optional[str] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    email: Optional[str] = None
    phone_number: str
    role: str
    is_active: bool
    password_hash_scheme: Optional[str] = None
    school_level: Optional[str] = None
    class_name: Optional[str] = None
    allowed_classes: List[str] = Field(default_factory=list)
    student_code: Optional[str] = None
