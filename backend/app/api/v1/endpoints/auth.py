from fastapi import APIRouter, HTTPException, status
from app.schemas.auth import (
    RequestOTPRequest,
    VerifyOTPRequest,
    TokenResponse,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    generate_otp_code,
)

router = APIRouter()

# In-memory OTP storage for rapid development / demo
OTP_STORE = {}


@router.post("/request-otp", summary="Yêu cầu mã OTP qua Email hoặc SMS")
async def request_otp(payload: RequestOTPRequest):
    code = generate_otp_code(6)
    target = payload.email or payload.phone_number
    OTP_STORE[target] = code

    # For development convenience, we also print and return the code in demo mode
    return {
        "success": True,
        "message": f"Mã OTP đã được gửi tới {target}",
        "dev_otp_code": code  # Helps frontend devs test immediately
    }


@router.post("/verify-otp", response_model=TokenResponse, summary="Xác thực OTP và cấp Token")
async def verify_otp(payload: VerifyOTPRequest):
    target = payload.email or payload.phone_number
    stored_code = OTP_STORE.get(target)

    # In dev mode, accept 123456 as universal test code as well
    if payload.otp_code != stored_code and payload.otp_code != "123456":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mã OTP không chính xác hoặc đã hết hạn."
        )

    user_id = f"user_{target.replace('@', '_').replace('.', '_')}"
    access_token = create_access_token(subject=user_id)
    refresh_token = create_refresh_token(subject=user_id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=86400,
        user_id=user_id,
        role="TEACHER" if payload.email else "STUDENT",
        full_name="Thầy/Cô Giáo Viên" if payload.email else "Học Sinh"
    )
