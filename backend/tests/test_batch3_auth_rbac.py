import base64
from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient

from app.api.admin_router import _ensure_default_admin
from app.core.config import settings
from app.core.database import in_memory_class_rosters, in_memory_classes, in_memory_schools, in_memory_users
from app.main import app

client = TestClient(app)


def _tiny_png_data_uri() -> str:
    img = Image.new("RGB", (24, 24), color=(30, 64, 175))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def test_h9b_server_answer_key_overrides_spoofed_client_correct_label():
    """H9b (luôn bật): Đáp án lưu trên server luôn thắng dù client gửi correct_label giả mạo."""
    sample = client.get("/api/v1/exam/sample", params={"subject": "TIENG_ANH", "mode": "STUDENT"})
    assert sample.status_code == 200
    q1 = sample.json()["questions"][0]  # Đáp án thật là C

    # Client gian lận chọn A và tự gửi kèm correct_label="A" -> vẫn phải chấm SAI theo khóa server (C)
    spoof_mcq = client.post(
        "/api/v1/exam/grade-mcq",
        json={
            "question_id": q1["id"],
            "selected_label": "A",
            "correct_label": "A",
            "subject": "TIENG_ANH",
            "question_content": q1["content"],
        },
    )
    assert spoof_mcq.status_code == 200
    assert spoof_mcq.json()["is_correct"] is False
    assert spoof_mcq.json()["correct_label"] == "C"

    spoof_circle = client.post(
        "/api/v1/exam/circle-answer",
        json={
            "question_id": q1["id"],
            "correct_label": "A",
            "subject": "TIENG_ANH",
            "stroke_bbox": {"x": 100, "y": 80, "width": 50, "height": 35},
            "option_regions": [
                {"label": "A", "x": 95, "y": 75, "width": 160, "height": 45},
                {"label": "C", "x": 95, "y": 190, "width": 160, "height": 45},
            ],
        },
    )
    assert spoof_circle.status_code == 200
    assert spoof_circle.json()["matched_label"] == "A"
    assert spoof_circle.json()["grade_result"]["is_correct"] is False
    assert spoof_circle.json()["grade_result"]["correct_label"] == "C"


def test_batch3_auth_enforce_gates_teacher_exam_sessions_and_scores(monkeypatch, auth_headers, make_auth_headers):
    """H9a, H8, N4, H10: Khi bật AUTH_ENFORCE=True, chặn truy cập không token / sai role; cho phép với token hợp lệ."""
    assert settings.AUTH_ENFORCE is False  # Repo mặc định log-only

    monkeypatch.setattr(settings, "AUTH_ENFORCE", True)
    student_headers = make_auth_headers("STUDENT", allowed_classes=["10A1"], class_name="10A1")

    # H9a: mode=TEACHER chặn không token (401) & chặn STUDENT (403); cho phép TEACHER (200)
    assert client.get("/api/v1/exam/sample", params={"subject": "TOAN", "mode": "TEACHER"}).status_code == 401
    assert client.get("/api/v1/exam/sample", params={"subject": "TOAN", "mode": "TEACHER"}, headers=student_headers).status_code == 403
    assert client.get("/api/v1/exam/sample", params={"subject": "TOAN", "mode": "TEACHER"}, headers=auth_headers).status_code == 200

    # H8 & N4: Đọc/ghi trang & snapshot yêu cầu token hợp lệ khi AUTH_ENFORCE=True
    assert client.get("/api/v1/sessions/pages/room-10a1/sess-1").status_code == 401
    assert client.post(
        "/api/v1/sessions/pages",
        json={"room_id": "room-10a1", "session_id": "sess-1", "page_number": 1, "canvas_json": {}},
    ).status_code == 401
    assert client.post(
        "/api/v1/sessions/pages",
        headers=student_headers,
        json={"room_id": "room-10a1", "session_id": "sess-1", "page_number": 1, "canvas_json": {}},
    ).status_code == 403
    assert client.post(
        "/api/v1/sessions/pages",
        headers=auth_headers,
        json={"room_id": "room-10a1", "session_id": "sess-1", "page_number": 1, "canvas_json": {}},
    ).status_code == 200

    # H10: Điểm thưởng yêu cầu TEACHER/ADMIN và lấy teacher_name từ token
    assert client.post(
        "/api/v1/scores/students",
        json={"class_name": "10A1", "full_name": "Học Sinh Mới"},
    ).status_code == 401
    add_ok = client.post(
        "/api/v1/scores/students",
        headers=auth_headers,
        json={"class_name": "10A1", "full_name": "Học Sinh Mới", "student_code": "10A1-HS-99"},
    )
    assert add_ok.status_code == 201
    stu_id = add_ok.json()["student"]["student_id"]

    award_ok = client.post(
        "/api/v1/scores/award",
        headers=auth_headers,
        json={
            "class_name": "10A1",
            "session_id": "sess-1",
            "room_id": "room-10a1",
            "student_id": stu_id,
            "teacher_name": "Tên Giả Từ Body",
            "subject": "TOAN",
            "points_added": 1.0,
            "reason": "Phát biểu tốt",
        },
    )
    assert award_ok.status_code == 200
    assert award_ok.json()["record"]["teacher_name"] == "Giáo Viên Kiểm Thử"


def test_n5_n6_n7_private_cache_signed_url_and_non_dev_guards(monkeypatch, make_auth_headers):
    """N5, N6, N7: Cache-Control private + URL ký ngắn hạn; chặn tự sinh HS demo & bài giảng mẫu khi APP_ENV != development."""
    stu_headers = make_auth_headers("STUDENT", allowed_classes=["9A9"], class_name="9A9")
    snap = client.post(
        "/api/v1/sessions/snapshots",
        json={
            "session_id": "s-9a9",
            "room_id": "room-9a9",
            "teacher_name": "Thầy Khoa",
            "class_name": "9A9",
            "subject": "TOAN",
            "recognized_latex": "x^2 = 9",
            "image_base64": _tiny_png_data_uri(),
        },
    ).json()
    snap_id = snap["snapshot_id"]

    lessons = client.get("/api/v1/auth/student/lessons", headers=stu_headers, params={"class_name": "9A9"})
    assert lessons.status_code == 200
    lesson_item = next(item for item in lessons.json()["items"] if item["id"] == snap_id)
    assert lesson_item.get("signed_exp") and lesson_item.get("signed_sig")

    # Tải bằng URL ký ngắn hạn khi bật AUTH_ENFORCE=True mà không cần gắn JWT 24h vào URL
    monkeypatch.setattr(settings, "AUTH_ENFORCE", True)
    img_res = client.get(
        f"/api/v1/sessions/snapshots/{snap_id}/image",
        params={"format": "webp", "exp": lesson_item["signed_exp"], "sig": lesson_item["signed_sig"]},
    )
    assert img_res.status_code == 200
    assert "private" in img_res.headers.get("cache-control", "")

    # N6 & N7 khi APP_ENV != development
    monkeypatch.setattr(settings, "AUTH_ENFORCE", False)
    monkeypatch.setattr(settings, "APP_ENV", "production")
    in_memory_class_rosters.pop("12Z9", None)
    prod_roster = client.get("/api/v1/scores/students", params={"class_name": "12Z9"})
    assert prod_roster.status_code == 200
    assert prod_roster.json()["count"] == 0

    blocked_demo = client.post(
        "/api/v1/demo/portal-sample-snapshot",
        json={
            "session_id": "demo-prod",
            "room_id": "room-9a9",
            "class_name": "9A9",
            "subject": "TOAN",
            "image_base64": _tiny_png_data_uri(),
        },
    )
    assert blocked_demo.status_code == 403


def test_h11_deleting_class_or_school_revokes_orphan_teacher_allowed_classes():
    """H11: Xóa lớp/trường chỉ thu hồi allowed_classes khi không còn lớp nào cùng tên chuẩn hóa ở trường khác."""
    _ensure_default_admin()
    admin_login = client.post(
        "/api/v1/admin/login",
        json={"email": settings.ADMIN_EMAIL, "password": settings.ADMIN_PASSWORD},
    )
    headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

    s1 = client.post(
        "/api/v1/admin/schools",
        headers=headers,
        json={"code": "SCH-H11-A", "name": "Trường H11 A", "level": "THPT"},
    ).json()["school"]["id"]
    s2 = client.post(
        "/api/v1/admin/schools",
        headers=headers,
        json={"code": "SCH-H11-B", "name": "Trường H11 B", "level": "THPT"},
    ).json()["school"]["id"]

    t_res = client.post(
        "/api/v1/admin/teachers",
        headers=headers,
        json={
            "full_name": "GV H11",
            "email": "gv.h11@aicanvas.edu.vn",
            "phone_number": "0966111222",
            "school_id": s1,
            "assigned_classes": [],
        },
    ).json()
    tid = t_res["teacher"]["id"]

    # Cả 2 trường đều có lớp 11B3, riêng trường 1 có thêm lớp 11C9
    c1_dup = client.post(
        "/api/v1/admin/classes",
        headers=headers,
        json={"school_id": s1, "name": "11B3", "grade": 11, "academic_year": "2026-2027", "homeroom_teacher_id": tid},
    ).json()["classroom"]["id"]
    c2_dup = client.post(
        "/api/v1/admin/classes",
        headers=headers,
        json={"school_id": s2, "name": "11B3", "grade": 11, "academic_year": "2026-2027", "homeroom_teacher_id": tid},
    ).json()["classroom"]["id"]
    c1_unique = client.post(
        "/api/v1/admin/classes",
        headers=headers,
        json={"school_id": s1, "name": "11C9", "grade": 11, "academic_year": "2026-2027", "homeroom_teacher_id": tid},
    ).json()["classroom"]["id"]

    assert set(in_memory_users[tid]["allowed_classes"]) == {"11B3", "11C9"}

    # Xóa 11B3 ở trường 1 -> trường 2 vẫn còn 11B3 nên KHÔNG thu hồi 11B3
    assert client.delete(f"/api/v1/admin/classes/{c1_dup}", headers=headers).status_code == 200
    assert "11B3" in in_memory_users[tid]["allowed_classes"]

    # Xóa tiếp 11B3 ở trường 2 -> không còn lớp 11B3 nào nữa nên thu hồi 11B3
    assert client.delete(f"/api/v1/admin/classes/{c2_dup}", headers=headers).status_code == 200
    assert "11B3" not in in_memory_users[tid]["allowed_classes"]
    assert "11C9" in in_memory_users[tid]["allowed_classes"]

    # Xóa trường 1 -> lớp 11C9 bị xóa theo và thu hồi khỏi GV
    assert client.delete(f"/api/v1/admin/schools/{s1}", headers=headers).status_code == 200
    assert "11C9" not in in_memory_users[tid]["allowed_classes"]
    in_memory_schools.pop(s2, None)
    _ = c1_unique


def test_n8_teacher_allowed_classes_enforced_under_auth_enforce(monkeypatch, make_auth_headers):
    """N8: Khi bật AUTH_ENFORCE, Giáo viên chỉ được thao tác trên lớp thuộc allowed_classes."""
    monkeypatch.setattr(settings, "AUTH_ENFORCE", True)
    teacher_10a1 = make_auth_headers("TEACHER", allowed_classes=["10A1", "12A1"], class_name="10A1")
    unassigned_teacher = make_auth_headers("TEACHER", allowed_classes=[], class_name=None)
    admin_headers = make_auth_headers("ADMIN", allowed_classes=["*"], class_name=None)

    # Giáo viên được phân công 10A1 -> truy cập 10A1 / room-10a1 thành công (200)
    ok_scores = client.get("/api/v1/scores/students", params={"class_name": "10A1"}, headers=teacher_10a1)
    assert ok_scores.status_code == 200
    ok_pages = client.get("/api/v1/sessions/pages/room-10a1/session-10a1-20261123", headers=teacher_10a1)
    assert ok_pages.status_code == 200

    # Giáo viên 10A1 cố tình đọc/ghi lớp 8A2 ngoài phân công -> bị chặn 403 Forbidden
    forbidden_scores = client.get("/api/v1/scores/students", params={"class_name": "8A2"}, headers=teacher_10a1)
    assert forbidden_scores.status_code == 403
    forbidden_pages = client.get("/api/v1/sessions/pages/room-8a2/session-8a2-20261123", headers=teacher_10a1)
    assert forbidden_pages.status_code == 403

    # Giáo viên chưa được Admin gán lớp nào -> bị chặn 403 Forbidden
    no_class_res = client.get("/api/v1/scores/students", params={"class_name": "10A1"}, headers=unassigned_teacher)
    assert no_class_res.status_code == 403

    # Admin giữ toàn quyền trên mọi lớp
    admin_ok = client.get("/api/v1/scores/students", params={"class_name": "8A2"}, headers=admin_headers)
    assert admin_ok.status_code == 200

