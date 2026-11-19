import base64
from io import BytesIO
from pathlib import Path
from PIL import Image
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import (
    Base,
    in_memory_ai_usage_logs,
    in_memory_snapshot_blobs,
    in_memory_users,
)
from app.main import app

client = TestClient(app)


def _make_distinct_png_data_uri(color=(12, 180, 95)) -> str:
    img = Image.new("RGB", (48, 32), color=color)
    buf = BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def test_sqlalchemy_orm_models_import_cleanly():
    """Fix #3: Đảm bảo Base tồn tại trong app.core.database để mọi model ORM import không lỗi."""
    from app.models.classroom import Classroom
    from app.models.quiz import Quiz
    from app.models.session import BoardSession
    from app.models.user import User

    assert Base is not None
    assert User.__tablename__
    assert Classroom.__tablename__
    assert BoardSession.__tablename__
    assert Quiz.__tablename__


def test_student_mode_masks_answer_but_grades_against_real_key():
    """Fix #2: Chế độ STUDENT ẩn correct_option nhưng Backend vẫn giữ đáp án thật (C) để chấm đúng."""
    res = client.get("/api/v1/exam/sample", params={"subject": "TIENG_ANH", "mode": "STUDENT"})
    assert res.status_code == 200
    questions = res.json()["questions"]
    assert len(questions) >= 1
    q1 = questions[0]
    assert q1["correct_option"] is None  # Bị che ở chế độ Học sinh

    # Học sinh chọn C (đáp án đúng thật của câu 1 Tiếng Anh mẫu) mà không gửi correct_label
    right = client.post(
        "/api/v1/exam/grade-mcq",
        json={
            "question_id": q1["id"],
            "selected_label": "C",
            "correct_label": None,
            "subject": "TIENG_ANH",
            "question_content": q1["content"],
        },
    )
    assert right.status_code == 200
    assert right.json()["is_correct"] is True
    assert right.json()["correct_label"] == "C"

    # Học sinh chọn A -> phải báo sai (trước khi sửa bị fallback nhầm thành 'A' nên chấm đúng oan)
    wrong = client.post(
        "/api/v1/exam/grade-mcq",
        json={
            "question_id": q1["id"],
            "selected_label": "A",
            "correct_label": None,
            "subject": "TIENG_ANH",
            "question_content": q1["content"],
        },
    )
    assert wrong.status_code == 200
    assert wrong.json()["is_correct"] is False
    assert wrong.json()["correct_label"] == "C"

    # Khoanh tròn trực tiếp trên bảng (TF28518) ở chế độ STUDENT cũng chấm theo đáp án C thật
    circled = client.post(
        "/api/v1/exam/circle-answer",
        json={
            "question_id": q1["id"],
            "correct_label": None,
            "subject": "TIENG_ANH",
            "stroke_bbox": {"x": 95, "y": 195, "width": 60, "height": 50},
            "option_regions": [
                {"label": "A", "x": 100, "y": 80, "width": 200, "height": 40},
                {"label": "C", "x": 90, "y": 190, "width": 200, "height": 45},
            ],
        },
    )
    assert circled.status_code == 200
    assert circled.json()["matched_label"] == "C"
    assert circled.json()["grade_result"]["is_correct"] is True


def test_offline_sync_populates_snapshot_blob_and_preview_url():
    """Fix #6: Ảnh đồng bộ từ Offline Mode phải lưu blob thật để Cổng ôn tập HS/PH tải được ảnh gốc."""
    png_uri = _make_distinct_png_data_uri((220, 45, 90))
    sync_res = client.post(
        "/api/v1/offline-sync/snapshots",
        json={
            "items": [
                {
                    "client_sync_id": "offline-fix6-check-001",
                    "session_id": "sess-offline-fix6",
                    "room_id": "room-10a1",
                    "class_name": "10A1",
                    "teacher_name": "Nguyễn Tuấn Khang",
                    "subject": "VAT_LY",
                    "period_number": 2,
                    "page_number": 1,
                    "trigger_type": "MANUAL_SAVE",
                    "image_base64": png_uri,
                    "recognized_latex": "F = m a",
                }
            ],
            "pages": [],
        },
    )
    assert sync_res.status_code == 200
    data = sync_res.json()
    assert data["synced_count"] == 1
    snap_id = data["results"][0]["snapshot_id"]
    assert snap_id in in_memory_snapshot_blobs

    img_res = client.get(f"/api/v1/sessions/snapshots/{snap_id}/image", params={"format": "png"})
    assert img_res.status_code == 200
    assert img_res.headers["content-type"] == "image/png"
    decoded = Image.open(BytesIO(img_res.content))
    assert decoded.size == (48, 32)


def test_deactivated_user_blocked_everywhere_and_otp_cannot_replay():
    """Fix #7a: OTP một lần không thể dùng lại; tài khoản bị Admin khóa bị chặn ở OTP, /me, /refresh và login."""
    email = "locked.teacher@rikkei.edu.vn"
    phone = "0933112233"

    otp_req = client.post(
        "/api/v1/auth/request-otp",
        json={"email": email, "phone_number": phone, "role": "TEACHER", "full_name": "GV Kiểm Thử"},
    )
    assert otp_req.status_code == 200
    code = otp_req.json()["dev_otp_code"]

    first_verify = client.post(
        "/api/v1/auth/verify-otp",
        json={
            "email": email,
            "phone_number": phone,
            "otp_code": code,
            "device_id": "board-room-1",
            "password": "SafePassword@123",
        },
    )
    assert first_verify.status_code == 200
    tokens = first_verify.json()

    # Dùng lại cùng mã OTP đó lần 2 phải bị từ chối 400
    replay_verify = client.post(
        "/api/v1/auth/verify-otp",
        json={"email": email, "phone_number": phone, "otp_code": code, "device_id": "board-room-1"},
    )
    assert replay_verify.status_code == 400

    # Admin khóa tài khoản -> chặn /me, chặn /refresh và chặn đăng nhập OTP mới
    in_memory_users[tokens["user_id"]]["is_active"] = False

    me_res = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert me_res.status_code == 403

    refresh_res = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"], "device_id": "board-room-1"},
    )
    assert refresh_res.status_code == 403

    otp_req_2 = client.post(
        "/api/v1/auth/request-otp",
        json={"email": email, "phone_number": phone, "role": "TEACHER"},
    )
    code_2 = otp_req_2.json()["dev_otp_code"]
    blocked_otp = client.post(
        "/api/v1/auth/verify-otp",
        json={"email": email, "phone_number": phone, "otp_code": code_2},
    )
    assert blocked_otp.status_code == 403


def test_class_room_rbac_prevents_suffix_collision():
    """Fix #7b: Phụ huynh lớp '2A' chỉ vào được 'room-2A', tuyệt đối không lọt vào 'room-12A'."""
    reg = client.post(
        "/api/v1/auth/student/register",
        json={
            "phone_number": "0944556677",
            "password": "Parent@2026!",
            "full_name": "Phụ huynh Bé An",
            "school_level": "TIEU_HOC",
            "class_name": "2A",
            "student_code": "HS2A_FIX7_01",
        },
    )
    assert reg.status_code == 200
    tok = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    ok_own = client.get("/api/v1/sessions/pages/room-2A/sess-demo", headers=headers)
    assert ok_own.status_code == 200

    ok_school_prefixed = client.get("/api/v1/sessions/pages/room-th-kimdong-2a/sess-demo", headers=headers)
    assert ok_school_prefixed.status_code == 200

    blocked_12a = client.get("/api/v1/sessions/pages/room-12A/sess-demo", headers=headers)
    assert blocked_12a.status_code == 403

    # Khóa tài khoản phụ huynh -> chặn đăng nhập SĐT
    in_memory_users[reg.json()["user_id"]]["is_active"] = False
    locked_login = client.post(
        "/api/v1/auth/student/login",
        json={"phone_number": "0944556677", "password": "Parent@2026!"},
    )
    assert locked_login.status_code == 403


def test_illustrate_without_gemini_key_tracks_as_mock_quota(monkeypatch):
    """Fix #8: Gọi /api/v1/illustrate khi chưa cấu hình GEMINI_API_KEY phải ghi nhận mock_calls thay vì live_calls."""
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    before_len = len(in_memory_ai_usage_logs)

    res = client.post("/api/v1/illustrate", json={"concept": "photosynthesis", "subject": "TIENG_ANH"})
    assert res.status_code == 200
    body = res.json()
    assert body.get("svg_content")
    assert len(in_memory_ai_usage_logs) == before_len + 1

    latest = in_memory_ai_usage_logs[0]
    assert latest["task_type"] == "VOCAB_IMAGE"
    assert latest["is_mock"] is True


def test_frontend_standalone_modules_and_fixes_present():
    """Kiểm tra Fix #1, #4, #5, #8 trên mã nguồn Frontend."""
    repo_root = Path(__file__).resolve().parents[2]

    auth_client_js = (repo_root / "frontend/src/utils/auth_client.js").read_text(encoding="utf-8")
    assert "from './context.js'" not in auth_client_js

    ai_rec_js = (repo_root / "frontend/src/components/aiRecognition.js").read_text(encoding="utf-8")
    quiz_board_js = (repo_root / "frontend/src/components/quiz_board.js").read_text(encoding="utf-8")
    assert "app:cancel-ai-debounce" in ai_rec_js
    assert "app:cancel-ai-debounce" in quiz_board_js

    page_mgr_js = (repo_root / "frontend/src/components/pageManager.js").read_text(encoding="utf-8")
    assert "'meta'" in page_mgr_js
    assert "answer_option" in page_mgr_js

    admin_html = (repo_root / "frontend/src/pages/admin.html").read_text(encoding="utf-8")
    assert "/assign-teacher" in admin_html
