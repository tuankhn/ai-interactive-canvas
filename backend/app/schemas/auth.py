from typing import Optional
from pydantic import BaseModel, EmailStr, ConfigDict


class RequestOTPRequest(BaseModel):
    email: Optional[EmailStr] = None
    phone_number: str
    role: str = "TEACHER"  # TEACHER, STUDENT, PARENT


class VerifyOTPRequest(BaseModel):
    email: Optional[EmailStr] = None
    phone_number: str
    otp_code: str
    remember_me: bool = True  # Keep 14 days session


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    role: str
    full_name: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    email: Optional[str]
    phone_number: str
    role: str
    is_active: bool
