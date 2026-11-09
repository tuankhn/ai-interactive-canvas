import logging
from fastapi import APIRouter
from app.schemas.canvas import (
    RecognizeCanvasRequest,
    RecognizeCanvasResponse,
    CorrectTokenRequest,
    PreprocessCanvasRequest,
    PreprocessCanvasResponse,
)
from app.ai import gemini_service
from app.services import image_processing_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post(
    "/preprocess",
    response_model=PreprocessCanvasResponse,
    summary="Tiền xử lý ảnh vùng vẽ bằng OpenCV và Pillow trước khi gửi AI (Task TF28506)"
)
async def preprocess_canvas(payload: PreprocessCanvasRequest):
    """
    Nhận ảnh từ Canvas, khử nhiễu, tăng độ tương phản và cắt sát vùng có nét chữ (Bounding Box)
    để tối ưu dung lượng và thời gian phản hồi của AI.
    """
    result = image_processing_service.preprocess_for_ai(
        image_input=payload.image_base64,
        padding=payload.padding,
        max_dim=payload.max_dim,
        output_format=payload.output_format,
    )
    return PreprocessCanvasResponse(**result)


@router.post(
    "/recognize",
    response_model=RecognizeCanvasResponse,
    summary="Nhận diện nét vẽ canvas & sinh đồ thị (Tự động tiền xử lý qua OpenCV)"
)
async def recognize_canvas(payload: RecognizeCanvasRequest):
    """
    Quy trình tích hợp:
    1. Tự động tiền xử lý ảnh (khử nhiễu, cắt sát nét chữ Bounding Box qua OpenCV/Pillow).
    2. Gửi ảnh đã tối ưu sang Gemini 2.5 Flash để bóc tách công thức và sinh đồ thị.
    """
    preprocessed = image_processing_service.preprocess_for_ai(payload.image_base64)
    optimized_image = preprocessed["processed_base64"]

    logger.info(
        f"Ảnh tiền xử lý: BBox={preprocessed['bounding_box']}, "
        f"Giảm {preprocessed['compression_ratio_percent']}% dung lượng "
        f"({preprocessed['original_size_kb']}KB -> {preprocessed['processed_size_kb']}KB)"
    )

    return await gemini_service.analyze_board(
        image_base64=optimized_image,
        subject=payload.subject,
        grade_level=payload.grade_level
    )


@router.post("/correct", summary="Người dùng sửa lỗi chữ AI nhận diện mơ hồ")
async def correct_token(payload: CorrectTokenRequest):
    return {
        "success": True,
        "session_id": payload.session_id,
        "corrected_text": payload.corrected_text,
        "message": f"Đã cập nhật ký tự '{payload.original_text}' thành '{payload.corrected_text}'"
    }
