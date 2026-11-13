# ==============================================================================
# KIỂM THỬ TOÀN DIỆN KẾT NỐI GEMINI 2.5 FLASH VÀ MATHPIX OCR (TF28508)
# Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import base64
import time
from io import BytesIO
from unittest.mock import patch, AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import app
from app.core.config import settings
from app.ai.gemini_service import gemini_service, GeminiAIService
from app.ai.mathpix_service import mathpix_service, MathpixOCRService
from app.services.ai_recognition import ai_recognition_service
from app.schemas.canvas_schema import RecognizeRequest

client = TestClient(app)


def generate_test_stroke_base64(text: str = "y = x^2 - 4x + 3", width: int = 500, height: int = 250) -> str:
    """Tạo ảnh nét viết tay mô phỏng trên Màn hình tương tác thông minh All-in-one"""
    img = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    # Vẽ các nét cong và đường biểu diễn công thức
    draw.line([(50, 150), (120, 100), (200, 180), (300, 80), (420, 160)], fill=(20, 20, 20), width=4)
    draw.text((60, 60), text, fill=(0, 0, 0))

    buf = BytesIO()
    img.save(buf, format="PNG")
    b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64_str}"


# -----------------------------------------------------------------------------
# 1. KIỂM THỬ MATHPIX OCR SERVICE
# -----------------------------------------------------------------------------
def test_mathpix_service_is_configured_logic():
    """Kiểm tra logic nhận diện API key của Mathpix"""
    service = MathpixOCRService()
    assert isinstance(service.is_configured, bool)


@pytest.mark.anyio
async def test_mathpix_mock_response():
    """Kiểm tra Mathpix Mock Engine phản hồi công thức LaTeX chuẩn xác và dưới 2 giây"""
    b64_img = generate_test_stroke_base64()
    start = time.perf_counter()
    res = await mathpix_service.recognize_latex(b64_img, subject="TOAN")
    elapsed = time.perf_counter() - start

    assert res["success"] is True
    assert "latex" in res
    assert res["confidence"] >= 0.90
    assert elapsed < 2.0  # Đảm bảo < 2 giây
    assert res["latency_ms"] < 2000


@pytest.mark.anyio
async def test_mathpix_live_call_mocked():
    """Kiểm tra gọi API Mathpix v3 thực tế với phản hồi giả lập thành công (mocked HTTP)"""
    b64_img = generate_test_stroke_base64()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "latex_styled": r"\int x^2 dx = \frac{x^3}{3} + C",
        "text": "int x^2 dx = x^3/3 + C",
        "confidence": 0.985,
        "confidence_rate": 0.985,
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        service = MathpixOCRService()
        service.app_id = "test_app_id"
        service.app_key = "test_app_key"

        res = await service.recognize_latex(b64_img, subject="TOAN")

        assert res["success"] is True
        assert res["latex"] == r"\int x^2 dx = \frac{x^3}{3} + C"
        assert res["provider"] == "mathpix"
        assert res["confidence"] == 0.985
        assert res["latency_ms"] < 2000


# -----------------------------------------------------------------------------
# 2. KIỂM THỬ GEMINI 2.5 FLASH SERVICE
# -----------------------------------------------------------------------------
@pytest.mark.anyio
async def test_gemini_service_mock_analysis():
    """Kiểm tra Gemini Vision Mock bóc tách công thức Toán và tạo siêu dữ liệu trực quan"""
    b64_img = generate_test_stroke_base64()
    start = time.perf_counter()
    res = await gemini_service.analyze_board(b64_img, subject="MATH")
    elapsed = time.perf_counter() - start

    assert res.subject in ["MATH", "TOAN"]
    assert "x^2" in res.latex or "y = x^2 - 4x + 3" in res.recognized_text
    assert res.confidence >= 0.90
    assert res.visualization is not None
    assert res.visualization.type == "2D_GRAPH"
    assert res.visualization.engine == "plotly"
    assert elapsed < 2.0


@pytest.mark.anyio
async def test_gemini_service_live_mocked():
    """Kiểm tra xử lý payload JSON từ Gemini 2.5 Flash loại bỏ bọc markdown codeblock"""
    b64_img = generate_test_stroke_base64()

    simulated_json = """```json
    {
        "recognized_text": "f(x) = sin(x)",
        "latex": "f(x) = \\\\sin(x)",
        "subject": "MATH",
        "confidence": 0.97,
        "has_ambiguity": false,
        "ambiguous_tokens": [],
        "visualization": {
            "type": "2D_GRAPH",
            "engine": "plotly",
            "title": "Hàm lượng giác sin",
            "parameters": {"function": "sin(x)"},
            "latex_formula": "f(x) = \\\\sin(x)"
        },
        "explanation": "Đồ thị hàm số sin(x) tuần hoàn với chu kỳ 2pi."
    }
    ```"""

    mock_model = MagicMock()
    mock_response = MagicMock()
    mock_response.text = simulated_json
    mock_model.generate_content.return_value = mock_response

    service = GeminiAIService()
    service.is_configured = True
    service.model = mock_model
    service._client_type = "google-generativeai"

    res = await service.analyze_board(b64_img, subject="MATH")

    assert res.recognized_text == "f(x) = sin(x)"
    assert res.latex == r"f(x) = \sin(x)"
    assert res.confidence == 0.97
    assert res.visualization.engine == "plotly"


# -----------------------------------------------------------------------------
# 3. KIỂM THỬ BỘ ĐIỀU PHỐI AI RECOGNITION SERVICE (TF28508)
# -----------------------------------------------------------------------------
@pytest.mark.anyio
async def test_ai_recognition_pipeline_math():
    """Kiểm tra luồng hoàn chỉnh từ nét vẽ -> tiền xử lý Bounding Box -> bóc tách LaTeX dưới 2 giây"""
    b64_img = generate_test_stroke_base64()
    req = RecognizeRequest(
        session_id="session-10a1",
        room_id="room-10a1",
        subject="TOAN",
        page_number=1,
        image_base64=b64_img,
        debounce_ms=800,
        provider="auto",
    )

    start = time.perf_counter()
    resp = await ai_recognition_service.recognize_canvas_strokes(req)
    total_time = time.perf_counter() - start

    assert resp.session_id == "session-10a1"
    assert resp.subject in ["TOAN", "MATH"]
    assert len(resp.latex) > 0
    assert resp.confidence >= 0.90
    assert resp.latency_ms < 2000  # Tiêu chí quan trọng: độ trễ dưới 2 giây
    assert total_time < 2.0
    assert resp.debounce_ms == 800
    assert resp.preprocess.bounding_box.width > 0
    assert resp.preprocess.bounding_box.height > 0
    assert resp.visualization is not None
    assert resp.visualization.get("type") == "2D_GRAPH"


@pytest.mark.anyio
async def test_ai_recognition_provider_routing():
    """Kiểm tra chuyển đổi linh hoạt giữa các nhà cung cấp auto, gemini và mathpix"""
    b64_img = generate_test_stroke_base64()

    # Route tới Mathpix
    req_mathpix = RecognizeRequest(image_base64=b64_img, subject="TOAN", provider="mathpix")
    resp_mathpix = await ai_recognition_service.recognize_canvas_strokes(req_mathpix)
    assert "mathpix" in resp_mathpix.provider

    # Route tới Gemini
    req_gemini = RecognizeRequest(image_base64=b64_img, subject="TOAN", provider="gemini")
    resp_gemini = await ai_recognition_service.recognize_canvas_strokes(req_gemini)
    assert "gemini" in resp_gemini.provider


@pytest.mark.anyio
async def test_ai_recognition_other_subjects():
    """Kiểm tra nhận diện công thức Vật lý và Hóa học"""
    b64_img = generate_test_stroke_base64()

    # Môn Vật Lý
    req_phys = RecognizeRequest(image_base64=b64_img, subject="VAT_LY", provider="gemini")
    resp_phys = await ai_recognition_service.recognize_canvas_strokes(req_phys)
    assert resp_phys.subject in ["VAT_LY", "PHYS"]
    assert "F =" in resp_phys.recognized_text or "m" in resp_phys.latex

    # Môn Hóa Học
    req_chem = RecognizeRequest(image_base64=b64_img, subject="HOA_HOC", provider="gemini")
    resp_chem = await ai_recognition_service.recognize_canvas_strokes(req_chem)
    assert resp_chem.subject in ["HOA_HOC", "CHEM"]
    assert "H2O" in resp_chem.recognized_text or "H_2" in resp_chem.latex


# -----------------------------------------------------------------------------
# 4. KIỂM THỬ CÁC ENDPOINT FASTAPI (ROUTER)
# -----------------------------------------------------------------------------
def test_api_recognize_endpoint_success():
    """Kiểm tra HTTP POST /api/v1/recognize trả về HTTP 200 và cấu trúc LaTeX"""
    b64_img = generate_test_stroke_base64()
    payload = {
        "session_id": "session-10a1",
        "room_id": "room-10a1",
        "subject": "TOAN",
        "page_number": 1,
        "image_base64": b64_img,
        "debounce_ms": 800,
        "provider": "auto"
    }

    response = client.post("/api/v1/recognize", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["session_id"] == "session-10a1"
    assert data["debounce_ms"] == 800
    assert data["latency_ms"] < 2000
    assert len(data["latex"]) > 0
    assert data["confidence"] > 0.85
    assert "preprocess" in data
    assert "visualization" in data


def test_api_recognize_endpoint_empty_image():
    """Kiểm tra HTTP POST /api/v1/recognize báo lỗi HTTP 400 khi thiếu image_base64"""
    response = client.post(
        "/api/v1/recognize",
        json={"session_id": "session-10a1", "subject": "TOAN", "image_base64": ""}
    )
    assert response.status_code == 400


def test_api_canvas_recognize_alias():
    """Kiểm tra HTTP POST /api/v1/canvas/recognize hoạt động tương thích"""
    b64_img = generate_test_stroke_base64()
    response = client.post(
        "/api/v1/canvas/recognize",
        json={"image_base64": b64_img, "subject": "TOAN", "debounce_ms": 800}
    )
    assert response.status_code == 200
    data = response.json()
    assert "latex" in data
    assert data["debounce_ms"] == 800


def test_api_debounce_config_endpoint():
    """Kiểm tra HTTP GET /api/v1/recognize/debounce-config trả về chuẩn 800ms debounce"""
    response = client.get("/api/v1/recognize/debounce-config")
    assert response.status_code == 200
    data = response.json()
    assert data["debounce_ms"] == 800
    assert data["max_latency_ms"] == 2000
    assert "All-in-one" in data["target_device"]


def test_api_providers_status_endpoint():
    """Kiểm tra HTTP GET /api/v1/recognize/providers trả về trạng thái Gemini và Mathpix"""
    response = client.get("/api/v1/recognize/providers")
    assert response.status_code == 200
    data = response.json()
    assert "gemini" in data
    assert "mathpix" in data
    assert data["debounce_standard"] == "800ms"
    assert data["performance_target"] == "< 2000ms"


def test_api_correct_token_endpoint():
    """Kiểm tra sửa ký tự mơ hồ qua HTTP POST /api/v1/canvas/correct-token"""
    payload = {
        "session_id": "session-10a1",
        "original_text": "sim",
        "corrected_text": "sin",
        "context_latex": "y = \\sim(x) + 1"
    }
    response = client.post("/api/v1/canvas/correct-token", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["updated_latex"] == "y = \\sin(x) + 1"
