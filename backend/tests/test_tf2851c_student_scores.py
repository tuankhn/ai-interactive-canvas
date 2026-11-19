import base64
from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient

from app.core.database import (
    in_memory_class_rosters,
    in_memory_score_logs,
    in_memory_snapshots,
    in_memory_student_bindings,
    in_memory_users,
)
from app.main import app

client = TestClient(app)


def _tiny_png_b64() -> str:
    img = Image.new("RGB", (80, 80), color=(255, 255, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def _reset_score_stores():
    in_memory_class_rosters.clear()
    in_memory_score_logs.clear()
    in_memory_snapshots.clear()
    in_memory_users.clear()
    in_memory_student_bindings.clear()


def test_list_class_students_includes_demo_and_registered_students():
    _reset_score_stores()

    # Đăng ký thêm một học sinh thật thuộc lớp 10A1
    reg = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Hoàng Tuấn Kiệt",
            "phone_number": "0933445566",
            "password": "Password123",
            "school_level": "THPT",
            "class_name": "10A1",
            "student_code": "HS-10A1-99",
        },
    )
    assert reg.status_code == 200

    res = client.get("/api/v1/scores/students", params={"class_name": "10A1"})
    assert res.status_code == 200
    body = res.json()
    assert body["class_name"] == "10A1"
    names = [item["full_name"] for item in body["items"]]
    assert "Nguyễn Minh Anh" in names
    assert "Hoàng Tuấn Kiệt" in names


def test_award_bonus_points_with_canvas_snapshot_and_history():
    _reset_score_stores()

    roster = client.get("/api/v1/scores/students", params={"class_name": "10A1"}).json()["items"]
    target = roster[0]

    # Lần 1: Cộng +1 điểm kèm ảnh chụp bài làm trên bảng
    award1 = client.post(
        "/api/v1/scores/award",
        json={
            "class_name": "10A1",
            "session_id": "sess-bonus-1",
            "room_id": "room-10a1",
            "student_id": target["student_id"],
            "teacher_name": "Thầy Khang",
            "subject": "TOAN",
            "points_added": 1,
            "reason": "Giải đúng phương trình trên bảng",
            "image_base64": _tiny_png_b64(),
        },
    )
    assert award1.status_code == 200
    d1 = award1.json()
    assert d1["status"] == "awarded"
    assert d1["total_points"] == 1.0
    assert d1["snapshot_saved"] is True
    assert d1["record"]["snapshot_id"] is not None
    assert len(in_memory_snapshots) == 1
    assert in_memory_snapshots[0]["trigger_type"] == "BONUS_SCORE"

    # Lần 2: Cộng thêm +2 điểm -> tổng thành 3.0
    award2 = client.post(
        "/api/v1/scores/award",
        json={
            "class_name": "10A1",
            "session_id": "sess-bonus-1",
            "student_id": target["student_id"],
            "points_added": 2,
            "reason": "Phát biểu xây dựng bài",
        },
    )
    assert award2.status_code == 200
    assert award2.json()["total_points"] == 3.0

    # Kiểm tra lịch sử & bảng xếp hạng lớp
    hist = client.get("/api/v1/scores/history", params={"class_name": "10A1"}).json()
    assert hist["count"] == 2
    assert hist["items"][0]["points_added"] == 2.0
    assert hist["items"][1]["snapshot_id"] == d1["record"]["snapshot_id"]

    board = client.get("/api/v1/scores/leaderboard", params={"class_name": "10A1"}).json()
    assert board["items"][0]["student_id"] == target["student_id"]
    assert board["items"][0]["total_points"] == 3.0


def test_add_student_to_roster_and_duplicate_code_conflict():
    _reset_score_stores()

    add_res = client.post(
        "/api/v1/scores/students",
        json={"class_name": "10A2", "full_name": "Đặng Gia Bảo", "student_code": "10A2-88"},
    )
    assert add_res.status_code == 201
    assert add_res.json()["student"]["full_name"] == "Đặng Gia Bảo"

    dup_res = client.post(
        "/api/v1/scores/students",
        json={"class_name": "10A2", "full_name": "Trùng Mã", "student_code": "10A2-88"},
    )
    assert dup_res.status_code == 409


def test_student_score_sidebar_assets_served():
    html_res = client.get("/")
    assert html_res.status_code == 200
    assert 'id="studentList"' in html_res.text
    assert 'id="scoreHistoryList"' in html_res.text
    assert 'class="score-step-btn' in html_res.text

    js_res = client.get("/src/components/student_score_sidebar.js")
    assert js_res.status_code == 200
    assert "setupStudentScoreSidebar" in js_res.text
    assert "/api/v1/scores" in js_res.text
