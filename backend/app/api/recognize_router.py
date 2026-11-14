# ==============================================================================
# ROUTE API NHẬN DIỆN NÉT VẼ AI (GEMINI 2.5 FLASH & MATHPIX OCR)
# (TASK TF28508) - Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.services.ai_recognition import ai_recognition_service
from app.services.image_processing import image_processing_service
from app.services.illustration_service import illustration_service
from app.schemas.canvas_schema import RecognizeRequest, RecognizeResponse
from app.schemas.canvas import (
    PreprocessCanvasRequest,
    PreprocessCanvasResponse,
    CorrectTokenRequest,
    IllustrationRequest,
    IllustrationResponse,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["AI Recognition"])


@router.post(
    "/recognize",
    response_model=RecognizeResponse,
    summary="Nhận diện nét viết tay sau khi dừng bút 800ms (debounce)",
    description="Nhận chuỗi Base64 ảnh nét vẽ từ bảng tương tác All-in-one, gọi Gemini 2.5 Flash / Mathpix OCR bóc tách công thức LaTeX và trả kết quả dưới 2 giây.",
)
async def recognize_strokes(request: RecognizeRequest):
    """
    API nhận diện nét viết tay đa môn:
    - Debounce 800ms: Được kích hoạt tự động từ SmartCanvas sau khi người dùng dừng vẽ 800ms.
    - Hỗ trợ đa môn: TOAN, VAT_LY, HOA_HOC, TIENG_ANH.
    - Bộ điều phối: Gemini 2.5 Flash (đa phương thức) + Mathpix (chuyên sâu LaTeX).
    - Phản hồi cực nhanh: Dưới 2.0 giây.
    """
    if not request.image_base64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chuỗi ảnh image_base64 không được để trống",
        )

    try:
        response = await ai_recognition_service.recognize_canvas_strokes(request)
        return response
    except Exception as e:
        logger.error(f"Lỗi trong quá trình nhận diện AI: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Xử lý nhận diện AI thất bại: {str(e)}",
        )


@router.post(
    "/canvas/recognize",
    summary="Endpoint nhận diện nét viết tay cho Canvas tương thích đa định dạng",
)
async def canvas_recognize_alias(payload: Dict[str, Any]):
    """
    Endpoint tương thích cho SmartCanvas và các kịch bản kiểm thử:
    Hỗ trợ nhận cả RecognizeRequest đầy đủ hoặc payload tối giản ({image_base64, subject}).
    """
    image_base64 = payload.get("image_base64", "")
    if not image_base64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chuỗi ảnh image_base64 không được để trống",
        )

    req = RecognizeRequest(
        session_id=payload.get("session_id", "session-10a1-toan"),
        room_id=payload.get("room_id", "room-10a1"),
        subject=payload.get("subject", "TOAN"),
        page_number=int(payload.get("page_number", 1)),
        image_base64=image_base64,
        stroke_hint=payload.get("stroke_hint"),
        debounce_ms=int(payload.get("debounce_ms", 800)),
        provider=payload.get("provider", "auto"),
        grade_level=payload.get("grade_level", "THPT"),
    )
    return await recognize_strokes(req)


@router.post(
    "/canvas/preprocess",
    response_model=PreprocessCanvasResponse,
    summary="Tiền xử lý nét vẽ Canvas (Bounding box, làm mịn, nén WebP)",
)
async def preprocess_canvas(request: PreprocessCanvasRequest):
    """
    Cắt sát vùng nét vẽ (Bounding box), loại bỏ viền trống 4K/FHD và nén WebP
    giảm 60-85% dung lượng trước khi gửi sang Gemini / Mathpix.
    """
    if not request.image_base64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chuỗi ảnh image_base64 không được để trống",
        )

    try:
        result = image_processing_service.preprocess_for_ai(
            image_input=request.image_base64,
            padding=request.padding,
            max_dim=request.max_dim,
            output_format=request.output_format,
        )
        return PreprocessCanvasResponse(**result)
    except Exception as e:
        logger.error(f"Lỗi tiền xử lý nét vẽ: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tiền xử lý ảnh thất bại: {str(e)}",
        )


@router.get(
    "/recognize/debounce-config",
    summary="Lấy cấu hình thời gian Debounce dừng bút và giới hạn độ trễ AI",
)
async def get_debounce_config():
    """
    Trả về cấu hình tiêu chuẩn cho Màn hình tương tác thông minh All-in-one:
    - debounce_ms: 800ms (thời gian chờ người dùng nhấc bút trước khi gửi API).
    - max_latency_ms: 2000ms (hạn mức thời gian AI trả kết quả).
    """
    return {
        "debounce_ms": 800,
        "max_latency_ms": 2000,
        "target_device": "Màn hình tương tác thông minh All-in-one (Interactive Flat Panel Display - IFP)",
        "supported_providers": ["auto", "gemini", "mathpix"],
        "default_subject": "TOAN",
        "description": "Sau khi dừng bút 800ms trên bảng vẽ, client tự động chụp snapshot nét vẽ và gửi lên API bóc tách LaTeX.",
    }


@router.get(
    "/recognize/providers",
    summary="Kiểm tra trạng thái kết nối các nhà cung cấp AI (Gemini 2.5 Flash & Mathpix)",
)
async def get_providers_status():
    """Kiểm tra tính sẵn sàng của Gemini 2.5 Flash và Mathpix OCR API."""
    return {
        "gemini": {
            "name": "Gemini 2.5 Flash",
            "model": settings.GEMINI_MODEL,
            "configured": ai_recognition_service.gemini.is_configured,
            "status": "ready" if ai_recognition_service.gemini.is_configured else "mock_fallback",
        },
        "mathpix": {
            "name": "Mathpix OCR API",
            "configured": ai_recognition_service.mathpix.is_configured,
            "status": "ready" if ai_recognition_service.mathpix.is_configured else "mock_fallback",
        },
        "performance_target": "< 2000ms",
        "debounce_standard": "800ms",
    }


@router.post(
    "/illustrate",
    response_model=IllustrationResponse,
    summary="Tạo hình ảnh minh họa nét phấn trắng cho từ vựng và khái niệm (Task TF2850F)",
    description="Khi giáo viên viết từ vựng Tiếng Anh hoặc khái niệm Sinh, Địa (như Photosynthesis, Solar System, Volcano), gọi AI tạo hình minh họa nét vẽ phấn trắng và đặt cạnh từ vựng.",
)
async def create_illustration(request: IllustrationRequest):
    """
    API tạo ảnh minh họa phấn trắng học đường (Chalkboard Sketch Vector):
    - Hỗ trợ từ vựng Tiếng Anh, khái niệm Sinh học, Địa lý.
    - Trả về mã SVG nét phấn trắng, Data URL Base64 và tọa độ đặt cạnh từ vựng.
    """
    if not request.concept or not request.concept.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tên khái niệm hoặc từ vựng không được để trống",
        )

    try:
        result = illustration_service.generate_chalk_illustration(
            concept=request.concept,
            subject=request.subject,
            target_bbox=request.target_bbox,
        )
        return IllustrationResponse(**result.model_dump())
    except Exception as e:
        logger.error(f"Lỗi tạo ảnh minh họa nét phấn: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tạo ảnh minh họa thất bại: {str(e)}",
        )


@router.post(
    "/canvas/illustrate",
    summary="Endpoint tương thích tạo ảnh minh họa phấn trắng cho SmartCanvas",
)
async def canvas_illustrate_alias(payload: Dict[str, Any]):
    concept = payload.get("concept") or payload.get("keyword") or payload.get("text") or ""
    if not concept:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tên khái niệm hoặc từ vựng không được để trống",
        )

    req = IllustrationRequest(
        concept=str(concept),
        subject=payload.get("subject", "TIENG_ANH"),
        style=payload.get("style", "white_chalk"),
        target_bbox=payload.get("target_bbox"),
    )
    return await create_illustration(req)


@router.post(
    "/canvas/correct-token",
    summary="Sửa ký tự mơ hồ hoặc công thức nhận diện chưa chuẩn",
)
async def correct_token(request: CorrectTokenRequest):
    """Tiếp nhận sửa lỗi ký tự từ popup gợi ý trên bảng vẽ và cập nhật biểu thức LaTeX."""
    updated_latex = request.context_latex or ""
    if request.original_text and request.corrected_text and updated_latex:
        updated_latex = updated_latex.replace(request.original_text, request.corrected_text)

    return {
        "status": "success",
        "session_id": request.session_id,
        "original_text": request.original_text,
        "corrected_text": request.corrected_text,
        "updated_latex": updated_latex,
        "message": "Đã cập nhật ký tự và công thức LaTeX thành công",
    }

