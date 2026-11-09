# ==============================================================================
# UNIT TESTS CHO TASK TF28506: TIỀN XỬ LÝ ẢNH BẰNG OPENCV VÀ PILLOW
# Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import base64
from io import BytesIO
import pytest
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app
from app.services.image_processing import image_processing_service

client = TestClient(app)


def create_mock_canvas_image(
    width: int = 800,
    height: int = 600,
    bg_color: tuple = (26, 46, 38),  # Xanh bảng phấn tối màu
    stroke_color: tuple = (245, 245, 240),  # Nét phấn trắng
    with_strokes: bool = True
) -> str:
    """Tạo ảnh canvas giả lập với nét vẽ ở giữa để test Bounding Box"""
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    if with_strokes:
        # Vẽ một công thức giả lập ở giữa: y = x^2 (vùng từ x=300 đến x=500, y=200 đến y=350)
        draw.line([(300, 250), (350, 300), (450, 220), (500, 320)], fill=stroke_color, width=5)
        draw.rectangle([380, 210, 420, 260], outline=stroke_color, width=4)

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


def test_decode_base64_input():
    """Kiểm tra giải mã Base64 sang ảnh PIL thành công"""
    data_url = create_mock_canvas_image()
    pil_img = image_processing_service.decode_input_to_image(data_url)
    assert pil_img is not None
    assert pil_img.size == (800, 600)


def test_detect_dark_and_light_board():
    """Kiểm tra tự động phân biệt bảng tối (Chalkboard) và bảng sáng (Whiteboard)"""
    # 1. Bảng phấn tối màu
    dark_url = create_mock_canvas_image(bg_color=(20, 35, 25))
    dark_pil = image_processing_service.decode_input_to_image(dark_url)
    dark_cv = image_processing_service.pil_to_cv2(dark_pil)
    assert image_processing_service.detect_background_type(dark_cv) == "DARK_BOARD"

    # 2. Bảng trắng viết bút lông
    light_url = create_mock_canvas_image(bg_color=(240, 245, 245), stroke_color=(20, 20, 20))
    light_pil = image_processing_service.decode_input_to_image(light_url)
    light_cv = image_processing_service.pil_to_cv2(light_pil)
    assert image_processing_service.detect_background_type(light_cv) == "LIGHT_BOARD"


def test_bounding_box_detection_and_crop():
    """Kiểm tra thuật toán phát hiện Bounding Box và cắt sát nét chữ"""
    data_url = create_mock_canvas_image(width=1000, height=800)
    result = image_processing_service.preprocess_for_ai(data_url, padding=20)

    assert result["has_strokes"] is True
    bbox = result["bounding_box"]
    assert len(bbox) == 4

    x, y, w, h = bbox
    # Nét vẽ nằm trong khoảng x: 300->500, y: 200->350. Kèm padding 20px
    assert 250 <= x <= 310
    assert 180 <= y <= 220
    assert w < 1000  # Đã cắt sát, nhỏ hơn kích thước ban đầu
    assert h < 800


def test_compression_and_payload_reduction():
    """Kiểm tra dung lượng sau xử lý giảm đáng kể so với ảnh canvas toàn màn hình"""
    data_url = create_mock_canvas_image(width=1200, height=900)
    result = image_processing_service.preprocess_for_ai(data_url)

    assert result["processed_size_kb"] < result["original_size_kb"]
    assert result["compression_ratio_percent"] > 0
    assert result["processed_base64"].startswith("data:image/webp;base64,")


def test_empty_canvas_handling():
    """Kiểm tra xử lý bảng trống (không có nét vẽ) không gây lỗi"""
    empty_url = create_mock_canvas_image(with_strokes=False)
    result = image_processing_service.preprocess_for_ai(empty_url)

    assert result["has_strokes"] is False
    assert result["processed_base64"] is not None


def test_api_preprocess_endpoint():
    """Kiểm tra endpoint FastAPI /api/v1/canvas/preprocess hoạt động chuẩn HTTP 200"""
    data_url = create_mock_canvas_image(width=600, height=400)
    response = client.post(
        "/api/v1/canvas/preprocess",
        json={
            "image_base64": data_url,
            "padding": 15,
            "max_dim": 800,
            "output_format": "WEBP"
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert "processed_base64" in data
    assert data["has_strokes"] is True
    assert "bounding_box" in data
    assert data["compression_ratio_percent"] > 0
