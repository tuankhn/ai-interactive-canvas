from fastapi import APIRouter
from app.api.v1.endpoints import auth, canvas, snapshots, quiz

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Xác thực & OTP"])
api_router.include_router(canvas.router, prefix="/canvas", tags=["Bảng vẽ & Nhận diện AI"])
api_router.include_router(snapshots.router, prefix="/snapshots", tags=["Snapshot & Xem lại bài"])
api_router.include_router(quiz.router, prefix="/quiz", tags=["Bài tập & Chấm điểm"])
