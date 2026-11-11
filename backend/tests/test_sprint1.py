# ==============================================================================
# KIỂM THỬ TỔNG HỢP GHÉP LUỒNG CANVAS VỚI NHẬN DIỆN AI (TASK TF28509)
# Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import base64
import time
from io import BytesIO
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import app

client = TestClient(app)


def make_canvas_image(draw_content: str = "formula") -> str:
    """Tạo ảnh nét vẽ từ bảng vẽ điện tử thông minh"""
    img = Image.new("RGBA", (800, 450), (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)
    # Giả lập nét bút cảm ứng (stylus) của giáo viên trên màn hình tương tác All-in-one
    draw.line([(80, 220), (160, 140), (240, 260), (320, 100), (450, 200)], fill=(0, 0, 0, 255), width=5)
    draw.text((100, 80), "y = x^2 - 4x + 3", fill=(0, 0, 0, 255))

    buf = BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('utf-8')}"


def test_canvas_draw_to_ai_roundtrip_latency():
    """
    Kiểm tra luồng người dùng vẽ trên SmartCanvas:
    - Sau khi dừng bút 800ms (debounce), client gửi dữ liệu ảnh lên API.
    - API bóc tách công thức và phản hồi kết quả trong vòng 2 giây.
    """
    canvas_b64 = make_canvas_image()

    start_client_time = time.perf_counter()

    response = client.post(
        "/api/v1/recognize",
        json={
            "session_id": "session-test-roundtrip",
            "room_id": "room-smartboard-101",
            "subject": "TOAN",
            "page_number": 1,
            "image_base64": canvas_b64,
            "debounce_ms": 800,
            "provider": "auto"
        }
    )

    client_elapsed = time.perf_counter() - start_client_time

    assert response.status_code == 200
    data = response.json()

    # Kiểm tra chuẩn phản hồi
    assert data["session_id"] == "session-test-roundtrip"
    assert data["debounce_ms"] == 800
    assert data["latency_ms"] < 2000  # API xử lý dưới 2000ms
    assert client_elapsed < 2.0  # Toàn bộ roundtrip mạng local dưới 2 giây
    assert "latex" in data and len(data["latex"]) > 0
    assert data["confidence"] >= 0.90
    assert data["preprocess"]["bounding_box"]["width"] > 0
    assert data["preprocess"]["size_reduction_percent"] >= 0


def test_debounce_timer_specification():
    """Kiểm tra cấu hình debounce 800ms cho màn hình tương tác thông minh All-in-one"""
    response = client.get("/api/v1/recognize/debounce-config")
    assert response.status_code == 200
    config = response.json()

    assert config["debounce_ms"] == 800
    assert config["max_latency_ms"] == 2000
    assert "All-in-one" in config["target_device"]


def test_canvas_alias_quick_recognition():
    """Kiểm tra gọi qua endpoint alias /api/v1/canvas/recognize với môn Toán"""
    canvas_b64 = make_canvas_image()
    response = client.post(
        "/api/v1/canvas/recognize",
        json={
            "image_base64": canvas_b64,
            "subject": "MATH"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["subject"] == "MATH"
    assert "x^2" in data["latex"] or "y = x^2" in data["recognized_text"]
    assert data["visualization"]["type"] == "2D_GRAPH"


def test_frontend_serving_index_html():
    """Kiểm tra máy chủ FastAPI phân phát trực tiếp giao diện Frontend có chứa các phần tử AI (Task TF28509)"""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    content = response.text
    assert "aiOverlayPanel" in content
    assert "aiRecognizeBtn" in content
    assert "autoAiToggle" in content
    assert "subjectSelect" in content
    assert "katex" in content


def test_frontend_serving_static_assets():
    """Kiểm tra phân phát trực tiếp style.css và app.js chứa logic debounce 800ms và nhận diện AI"""
    resp_css = client.get("/style.css")
    assert resp_css.status_code == 200
    assert ".ai-overlay-panel" in resp_css.text

    resp_js = client.get("/app.js")
    assert resp_js.status_code == 200
    assert "scheduleAIDebounce" in resp_js.text
    assert "performAIRecognition" in resp_js.text


def test_canvas_multisubject_recognition_flow():
    """Kiểm tra ghép luồng nhận diện nét vẽ cho nhiều môn học (Lý, Hóa, Anh)"""
    canvas_b64 = make_canvas_image()
    subjects = ["VAT_LY", "HOA_HOC", "TIENG_ANH"]
    for subj in subjects:
        resp = client.post(
            "/api/v1/recognize",
            json={
                "session_id": "session-demo",
                "room_id": "room-demo",
                "subject": subj,
                "image_base64": canvas_b64,
                "debounce_ms": 800,
                "provider": "auto"
            }
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["subject"] == subj
        assert len(data["recognized_text"]) > 0
        assert data["latency_ms"] < 2000
