# ==============================================================================
# BỘ KIỂM THỬ TÍNH NĂNG AI TẠO ẢNH MINH HỌA TỪ VỰNG VÀ KHÁI NIỆM
# (TASK TF2850F) - Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.illustration_service import illustration_service
from app.schemas.canvas import IllustrationRequest, IllustrationResponse, ChalkIllustrationData


@pytest.fixture
def client():
    return TestClient(app)


# ------------------------------------------------------------------------------
# 1. KIỂM THỬ ILLUSTRATION SERVICE (UNIT TESTS)
# ------------------------------------------------------------------------------

def test_illustration_photosynthesis_biology():
    """Kiểm thử tạo ảnh minh họa nét phấn trắng cho khái niệm Sinh học Photosynthesis (Quang hợp)."""
    res = illustration_service.generate_chalk_illustration("Photosynthesis", subject="SINH_HOC")
    assert isinstance(res, ChalkIllustrationData)
    assert res.concept == "Photosynthesis"
    assert res.subject == "SINH_HOC"
    assert res.illustration_type == "CHALK_SVG"
    assert "<svg" in res.svg_content
    assert "</svg>" in res.svg_content
    assert "data:image/svg+xml;base64," in res.image_data_url
    assert "quang hợp" in res.caption.lower()
    assert res.suggested_position["x"] > 0
    assert res.suggested_position["width"] == 220


def test_illustration_volcano_geography():
    """Kiểm thử tạo ảnh minh họa nét phấn trắng cho khái niệm Địa lý Volcano (Núi lửa)."""
    res = illustration_service.generate_chalk_illustration("Volcano", subject="DIA_LY")
    assert isinstance(res, ChalkIllustrationData)
    assert res.concept == "Volcano"
    assert res.subject == "DIA_LY"
    assert "<svg" in res.svg_content
    assert "núi lửa" in res.caption.lower()
    assert "dung nham" in res.description.lower() or "magma" in res.description.lower()


def test_illustration_solar_system_astronomy():
    """Kiểm thử tạo ảnh minh họa nét phấn trắng cho khái niệm Hệ Mặt Trời (Solar System)."""
    res = illustration_service.generate_chalk_illustration("Solar System", subject="DIA_LY")
    assert isinstance(res, ChalkIllustrationData)
    assert "<svg" in res.svg_content
    assert "mặt trời" in res.caption.lower()
    assert "hành tinh" in res.description.lower() or "mặt trời" in res.description.lower()


def test_illustration_cell_biology():
    """Kiểm thử tạo ảnh minh họa nét phấn trắng cho cấu tạo Tế bào (Cell)."""
    res = illustration_service.generate_chalk_illustration("Cell", subject="SINH_HOC")
    assert isinstance(res, ChalkIllustrationData)
    assert "<svg" in res.svg_content
    assert "tế bào" in res.caption.lower()


def test_illustration_english_vocabulary():
    """Kiểm thử tạo ảnh minh họa nét phấn trắng cho các từ vựng Tiếng Anh (Apple, Book, Tree, House)."""
    for vocab in ["Apple", "Book", "Tree", "House"]:
        res = illustration_service.generate_chalk_illustration(vocab, subject="TIENG_ANH")
        assert isinstance(res, ChalkIllustrationData)
        assert res.concept == vocab
        assert res.subject == "TIENG_ANH"
        assert "<svg" in res.svg_content
        assert res.image_data_url.startswith("data:image/svg+xml;base64,")


def test_illustration_custom_procedural_fallback():
    """Kiểm thử tạo vector phấn trắng tự động cho khái niệm mới chưa có trong từ điển mẫu."""
    custom_concept = "Quantum Computing"
    res = illustration_service.generate_chalk_illustration(custom_concept, subject="VAT_LY")
    assert isinstance(res, ChalkIllustrationData)
    assert res.concept == custom_concept
    assert "<svg" in res.svg_content
    assert "Quantum Computing" in res.svg_content
    assert res.suggested_position["x"] > 0


def test_illustration_placement_next_to_vocabulary():
    """
    Kiểm thử yêu cầu đề bài: Đặt hình minh họa nét vẽ phấn trắng cạnh từ vựng.
    Kiểm tra tọa độ suggested_position được tính toán nằm bên phải vùng chữ viết [x, y, w, h].
    """
    target_bbox = [100, 80, 200, 60]  # x=100, y=80, w=200, h=60
    res = illustration_service.generate_chalk_illustration("Photosynthesis", subject="SINH_HOC", target_bbox=target_bbox)
    # Vị trí x của hình minh họa phải nằm bên phải chữ viết: x >= target_x + target_w
    assert res.suggested_position["x"] >= target_bbox[0] + target_bbox[2]
    assert res.suggested_position["y"] == target_bbox[1]


# ------------------------------------------------------------------------------
# 2. KIỂM THỬ ENDPOINT API (INTEGRATION TESTS)
# ------------------------------------------------------------------------------

def test_api_create_illustration_endpoint(client):
    """Kiểm thử POST /api/v1/illustrate tạo ảnh minh họa chuẩn."""
    payload = {
        "concept": "Volcano",
        "subject": "DIA_LY",
        "style": "white_chalk",
        "target_bbox": [50, 60, 180, 50]
    }
    resp = client.post("/api/v1/illustrate", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["concept"] == "Volcano"
    assert data["subject"] == "DIA_LY"
    assert data["illustration_type"] == "CHALK_SVG"
    assert "<svg" in data["svg_content"]
    assert data["image_data_url"].startswith("data:image/svg+xml;base64,")
    assert data["suggested_position"]["x"] >= 50 + 180


def test_api_create_illustration_empty_concept(client):
    """Kiểm thử POST /api/v1/illustrate với chuỗi rỗng trả về HTTP 400 Bad Request."""
    resp = client.post("/api/v1/illustrate", json={"concept": "   "})
    assert resp.status_code == 400
    assert "không được để trống" in resp.json()["detail"]


def test_api_canvas_illustrate_alias_endpoint(client):
    """Kiểm thử endpoint tương thích POST /api/v1/canvas/illustrate."""
    payload = {
        "keyword": "Solar System",
        "subject": "DIA_LY"
    }
    resp = client.post("/api/v1/canvas/illustrate", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["concept"] == "Solar System"
    assert "<svg" in data["svg_content"]


def test_api_recognize_auto_includes_illustration(client):
    """
    Kiểm thử quy trình nhận diện toàn diện: Khi gửi nét vẽ từ vựng Tiếng Anh / Sinh / Địa,
    kết quả trả về từ /api/v1/recognize tự động đính kèm hình minh họa nét phấn trắng (Chalk Illustration).
    """
    # Ảnh trắng 100x100 mô phỏng
    dummy_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    payload = {
        "session_id": "session-test-bio",
        "room_id": "room-test",
        "subject": "SINH_HOC",
        "page_number": 1,
        "image_base64": dummy_b64,
        "debounce_ms": 800,
        "provider": "auto"
    }
    resp = client.post("/api/v1/recognize", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["subject"] == "SINH_HOC"
    # Kiểm tra trường illustration đã được tự động đính kèm
    assert data["illustration"] is not None
    assert "<svg" in data["illustration"]["svg_content"]
    assert data["illustration"]["image_data_url"].startswith("data:image/svg+xml;base64,")
