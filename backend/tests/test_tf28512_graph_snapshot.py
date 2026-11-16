# ==============================================================================
# BỘ KIỂM THỬ TÍCH HỢP & HIỆU NĂNG LUỒNG CÔNG THỨC, ĐỒ THỊ 2D VÀ LƯU SNAPSHOT
# (TASK TF28512) - Sprint 3
# Phụ trách: Nguyễn Ngọc Gia Bảo 2 (N25DTCN121)
# ==============================================================================

import base64
import time
from io import BytesIO
from PIL import Image, ImageDraw
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import in_memory_pages, in_memory_snapshots
from app.services.ai_recognition import ai_recognition_service
from app.schemas.canvas import RecognizeCanvasRequest, RecognizeCanvasResponse

client = TestClient(app)


def generate_mock_board_image_b64(has_graph: bool = True) -> str:
    """Tạo ảnh bảng mô phỏng (PNG Base64) có nét phấn và đồ thị 2D để kiểm thử thực tế."""
    img = Image.new("RGB", (640, 480), color=(17, 24, 39))  # Màu nền bảng tối
    draw = ImageDraw.Draw(img)

    # Vẽ nét phấn công thức: y = x^2 - 4x + 3
    draw.line([(50, 60), (120, 60)], fill=(248, 250, 252), width=3)
    draw.line([(140, 50), (220, 70)], fill=(248, 250, 252), width=3)

    # Vẽ khung đồ thị 2D nếu có
    if has_graph:
        draw.rectangle([(280, 50), (600, 350)], outline=(37, 99, 235), width=2)
        draw.line([(290, 200), (590, 200)], fill=(100, 116, 139), width=1)  # Trục Ox
        draw.line([(440, 60), (440, 340)], fill=(100, 116, 139), width=1)  # Trục Oy
        # Đường cong Parabol
        points = [(x, int(200 - 0.05 * (x - 440) ** 2 + 50)) for x in range(320, 560, 5)]
        for i in range(len(points) - 1):
            draw.line([points[i], points[i + 1]], fill=(103, 232, 249), width=2)

    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


# ------------------------------------------------------------------------------
# 1. KIỂM THỬ THÔNG SỐ ĐỒ THỊ 2D TỪ CÔNG THỨC TOÁN HỌC (PARABOL, BẬC 1, 3, LƯỢNG GIÁC)
# ------------------------------------------------------------------------------

def test_math_visualization_parabola_2d():
    """Kiểm thử bóc tách hàm số bậc hai (Parabol) và sinh metadata đồ thị 2D Plotly."""
    formula = "y = x^2 - 4x + 3"
    vis = ai_recognition_service._build_math_visualization(formula)

    assert vis is not None
    assert vis["type"] == "2D_GRAPH"
    assert vis["engine"] == "plotly"
    assert "Parabol" in vis["title"]
    assert vis["parameters"]["function"] == "x**2 - 4*x + 3"
    assert vis["parameters"]["degree"] == 2
    assert vis["parameters"]["roots"] == [1, 3]
    assert vis["parameters"]["vertex"] == [2, -1]
    assert vis["parameters"]["x_range"] == [-2, 6]


def test_math_visualization_trig_functions():
    """Kiểm thử sinh thông số đồ thị 2D cho các hàm lượng giác sin, cos, tan."""
    # Hàm sin
    vis_sin = ai_recognition_service._build_math_visualization("y = \\sin(x)")
    assert vis_sin["type"] == "2D_GRAPH"
    assert vis_sin["parameters"]["function"] == "sin(x)"
    assert vis_sin["parameters"]["amplitude"] == 1.0

    # Hàm cos
    vis_cos = ai_recognition_service._build_math_visualization("y = \\cos(x)")
    assert vis_cos["type"] == "2D_GRAPH"
    assert vis_cos["parameters"]["function"] == "cos(x)"
    assert vis_cos["parameters"]["period"] == "2\\pi"

    # Hàm tan
    vis_tan = ai_recognition_service._build_math_visualization("y = \\tan(x)")
    assert vis_tan["type"] == "2D_GRAPH"
    assert vis_tan["parameters"]["function"] == "tan(x)"


def test_math_visualization_linear_and_cubic():
    """Kiểm thử sinh thông số đồ thị 2D cho hàm bậc nhất và hàm bậc ba."""
    # Hàm bậc nhất
    vis_linear = ai_recognition_service._build_math_visualization("y = 2x + 1")
    assert vis_linear["type"] == "2D_GRAPH"
    assert vis_linear["parameters"]["degree"] == 1
    assert vis_linear["parameters"]["slope"] == 2.0
    assert vis_linear["parameters"]["intercept"] == 1.0

    # Hàm bậc ba
    vis_cubic = ai_recognition_service._build_math_visualization("y = x^3 - 3x^2 + 2x - 1")
    assert vis_cubic["type"] == "2D_GRAPH"
    assert vis_cubic["parameters"]["degree"] == 3
    assert "x**3" in vis_cubic["parameters"]["function"]


# ------------------------------------------------------------------------------
# 2. KIỂM THỬ HIỆU NĂNG THỰC TẾ: ĐỘ TRỄ DƯỚI 3 GIÂY (< 3000ms)
# ------------------------------------------------------------------------------

def test_end_to_end_recognition_and_graph_latency_under_3_seconds():
    """
    Tiêu chí đặc tả Sprint 3 (Task TF28512):
    Chạy thử nghiệm thực tế từ lúc nhận diện hàm số đến khi sinh thông số đồ thị 2D
    phải đảm bảo độ trễ dưới 3 giây (< 3000ms).
    """
    img_b64 = generate_mock_board_image_b64(has_graph=True)
    payload = {
        "image_base64": img_b64,
        "subject": "TOAN",
        "debounce_ms": 800,
    }

    latencies = []
    # Chạy lặp 10 lần thực tế để đo phân bố thời gian (min, max, avg)
    for _ in range(10):
        t0 = time.perf_counter()
        resp = client.post("/api/v1/canvas/recognize", json=payload)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        latencies.append(elapsed_ms)

        assert resp.status_code == 200
        data = resp.json()
        assert data["visualization"] is not None
        assert data["visualization"]["type"] == "2D_GRAPH"

    min_lat = min(latencies)
    max_lat = max(latencies)
    avg_lat = sum(latencies) / len(latencies)

    # Đảm bảo 100% các lần đo đều < 3000ms (3.0 giây)
    assert max_lat < 3000.0, f"Độ trễ vượt quá 3 giây: {max_lat}ms"
    # Mức độ trung bình lý tưởng < 1500ms
    assert avg_lat < 1500.0, f"Độ trễ trung bình quá cao: {avg_lat}ms"


# ------------------------------------------------------------------------------
# 3. KIỂM THỬ LƯU ẢNH BẢNG (SNAPSHOT) THÀNH CÔNG TRƯỚC KHI XÓA BẢNG
# ------------------------------------------------------------------------------

def test_snapshot_before_clear_board_success():
    """
    Kiểm thử lưu ảnh bảng thành công trước khi xóa bảng (trigger_type = BEFORE_CLEAR).
    Đảm bảo ảnh bảng được lưu vào MinIO / hệ thống lưu trữ với đầy đủ thẻ phân loại và thời hạn 6 tháng.
    """
    img_b64 = generate_mock_board_image_b64(has_graph=True)
    payload = {
        "session_id": "session-test-10a1",
        "room_id": "room-test-10a1",
        "class_name": "10A1",
        "teacher_name": "Nguyễn Ngọc Gia Bảo",
        "subject": "TOAN",
        "period_number": 1,
        "page_number": 1,
        "trigger_type": "BEFORE_CLEAR",
        "image_base64": img_b64,
        "recognized_latex": "y = x^2 - 4x + 3",
    }

    resp = client.post("/api/v1/sessions/snapshots", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["status"] == "saved"
    assert "snapshot_id" in data
    assert data["tags"]["class_name"] == "10A1"
    assert data["tags"]["subject"] == "TOAN"
    assert data["tags"]["teacher_name"] == "Nguyễn Ngọc Gia Bảo"
    assert "image_url" in data
    assert data["image_format"] in ["webp", "png"]
    assert "retention_until" in data  # Thời hạn lưu trữ tối thiểu 6 tháng


def test_snapshot_before_delete_page_success():
    """Kiểm thử lưu ảnh bảng thành công trước khi xóa trang (trigger_type = BEFORE_DELETE_PAGE)."""
    img_b64 = generate_mock_board_image_b64(has_graph=False)
    payload = {
        "session_id": "session-test-10a1",
        "room_id": "room-test-10a1",
        "class_name": "10A1",
        "teacher_name": "Nguyễn Ngọc Gia Bảo",
        "subject": "TOAN",
        "period_number": 1,
        "page_number": 2,
        "trigger_type": "BEFORE_DELETE_PAGE",
        "image_base64": img_b64,
        "recognized_latex": "y = 2x + 1",
    }

    resp = client.post("/api/v1/sessions/snapshots", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "saved"
    assert data["tags"]["page_number"] == 2


# ------------------------------------------------------------------------------
# 4. KIỂM THỬ TRUY VẤN VÀ TÌM KIẾM SNAPSHOT THEO MÔN, LỚP VÀ CÔNG THỨC OCR
# ------------------------------------------------------------------------------

def test_query_and_search_snapshots():
    """Kiểm thử tìm kiếm snapshot đã lưu theo tên lớp, môn học và chuỗi công thức LaTeX."""
    # Tìm kiếm theo lớp và môn
    resp = client.get("/api/v1/sessions/snapshots?class_name=10A1&subject=TOAN")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    assert any(item["tags"]["class_name"] == "10A1" for item in data["items"])

    # Tìm kiếm theo từ khóa công thức hàm số OCR (q=x^2)
    search_resp = client.get("/api/v1/sessions/snapshots?q=x^2")
    assert search_resp.status_code == 200
    search_data = search_resp.json()
    assert search_data["count"] >= 1
    matched = [item for item in search_data["items"] if "x^2" in item.get("recognized_latex", "")]
    assert len(matched) >= 1


def test_snapshot_invalid_image_error_handling():
    """Kiểm thử xử lý ngoại lệ khi ảnh snapshot gửi lên không hợp lệ."""
    payload = {
        "session_id": "session-err",
        "room_id": "room-err",
        "class_name": "10A1",
        "teacher_name": "Nguyễn Ngọc Gia Bảo",
        "subject": "TOAN",
        "period_number": 1,
        "page_number": 1,
        "trigger_type": "BEFORE_CLEAR",
        "image_base64": "not_a_valid_base64_string",
    }
    resp = client.post("/api/v1/sessions/snapshots", json=payload)
    assert resp.status_code == 400
    assert "Không thể xử lý ảnh" in resp.json()["detail"]


# ------------------------------------------------------------------------------
# 5. KIỂM THỬ TOÀN DIỆN LUỒNG E2E (TỪ VIẾT HÀM SỐ -> DỰNG ĐỒ THỊ -> LƯU SNAPSHOT -> XÓA)
# ------------------------------------------------------------------------------

def test_full_workflow_write_formula_graph_snapshot_and_clear():
    """
    Kiểm thử tích hợp kịch bản trọn vẹn (End-to-End Simulation):
    1. Giáo viên viết hàm số y = x^2 - 4x + 3 trên mặt bảng.
    2. AI nhận diện và sinh metadata đồ thị 2D trong thời gian < 3 giây.
    3. Kiểm tra các tham số hàm số, đỉnh, nghiệm của đồ thị.
    4. Trước khi xóa bảng, hệ thống lưu Snapshot thành công với trigger BEFORE_CLEAR.
    5. Dữ liệu Snapshot được bảo toàn đầy đủ và có thể truy xuất lại.
    """
    total_start_time = time.perf_counter()

    # Bước 1: Gửi ảnh nét vẽ hàm số lên Backend AI
    img_b64 = generate_mock_board_image_b64(has_graph=True)
    rec_resp = client.post("/api/v1/canvas/recognize", json={
        "image_base64": img_b64,
        "subject": "TOAN",
        "debounce_ms": 800
    })
    assert rec_resp.status_code == 200
    rec_data = rec_resp.json()

    # Bước 2: Kiểm tra đồ thị 2D Plotly được dựng thành công
    vis = rec_data.get("visualization")
    assert vis is not None
    assert vis["type"] == "2D_GRAPH"
    assert vis["engine"] == "plotly"
    assert "x**2" in vis["parameters"]["function"]

    # Bước 3: Đảm bảo thời gian từ lúc nhận diện đến khi có thông số đồ thị < 3 giây
    graph_ready_time = (time.perf_counter() - total_start_time) * 1000
    assert graph_ready_time < 3000.0, f"Tổng thời gian dựng đồ thị vượt quá 3 giây: {graph_ready_time}ms"

    # Bước 4: Kích hoạt sự kiện lưu Snapshot trước khi xóa bảng
    snap_resp = client.post("/api/v1/sessions/snapshots", json={
        "session_id": "session-e2e-demo",
        "room_id": "room-e2e-demo",
        "class_name": "10A1",
        "teacher_name": "Nguyễn Ngọc Gia Bảo",
        "subject": "TOAN",
        "period_number": 2,
        "page_number": 1,
        "trigger_type": "BEFORE_CLEAR",
        "image_base64": img_b64,
        "recognized_latex": rec_data.get("latex") or "y = x^2 - 4x + 3"
    })
    assert snap_resp.status_code == 200
    snap_data = snap_resp.json()
    assert snap_data["status"] == "saved"
    assert snap_data["tags"]["class_name"] == "10A1"

    # Bước 5: Kiểm tra Snapshot đã nằm trong cơ sở dữ liệu để giáo viên không bị mất bài
    verify_resp = client.get("/api/v1/sessions/snapshots?class_name=10A1")
    assert verify_resp.status_code == 200
    items = verify_resp.json()["items"]
    e2e_snapshot = next((s for s in items if s.get("id") == snap_data["snapshot_id"]), None)
    assert e2e_snapshot is not None
    assert e2e_snapshot["trigger_type"] == "BEFORE_CLEAR"
    assert "x^2" in e2e_snapshot["recognized_latex"]
