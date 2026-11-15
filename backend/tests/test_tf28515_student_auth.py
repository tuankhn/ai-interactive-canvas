import base64
from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient

from app.core.database import (
    in_memory_otps,
    in_memory_refresh_sessions,
    in_memory_snapshots,
    in_memory_student_bindings,
    in_memory_users,
)
from app.main import app

client = TestClient(app)


def _tiny_png_b64() -> str:
    img = Image.new("RGB", (64, 64), color=(255, 255, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def _reset_auth_stores():
    in_memory_users.clear()
    in_memory_student_bindings.clear()
    in_memory_otps.clear()
    in_memory_refresh_sessions.clear()


def test_student_parent_registration_one_account_per_student_and_login():
    _reset_auth_stores()

    # 1. Tiểu học bắt buộc đăng ký bằng SĐT phụ huynh (role=PARENT)
    bad_elem = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Bé An",
            "phone_number": "0901112223",
            "password": "PassWord123",
            "school_level": "TIEU_HOC",
            "class_name": "5B",
            "student_code": "HS-5B-01",
            "role": "STUDENT",
        },
    )
    assert bad_elem.status_code == 422

    parent_reg = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Phụ huynh Bé An",
            "phone_number": "0901112223",
            "password": "PassWord123",
            "school_level": "TIEU_HOC",
            "class_name": "5B",
            "student_code": "HS-5B-01",
        },
    )
    assert parent_reg.status_code == 200
    p_tok = parent_reg.json()
    assert p_tok["role"] == "PARENT"
    assert p_tok["class_name"] == "5B"
    assert p_tok["allowed_classes"] == ["5B"]

    # 2. Mỗi học sinh chỉ được gắn 1 tài khoản (không cho đăng ký SĐT thứ 2 cùng student_code)
    dup_student = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Tài khoản thứ 2 cùng HS",
            "phone_number": "0909998887",
            "password": "PassWord123",
            "school_level": "TIEU_HOC",
            "class_name": "5B",
            "student_code": "HS-5B-01",
        },
    )
    assert dup_student.status_code == 409

    # 3. Học sinh THPT đăng ký bằng SĐT học sinh và đăng nhập lại
    hs_reg = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Nguyễn Minh Quân",
            "phone_number": "0915556667",
            "password": "QuanPassword!",
            "school_level": "THPT",
            "class_name": "10A1",
            "student_code": "HS-10A1-09",
        },
    )
    assert hs_reg.status_code == 200
    assert hs_reg.json()["role"] == "STUDENT"

    hs_login = client.post(
        "/api/v1/auth/student/login",
        json={"phone_number": "+84 915 556 667", "password": "QuanPassword!"},
    )
    assert hs_login.status_code == 200
    assert hs_login.json()["allowed_classes"] == ["10A1"]


def test_student_forgot_password_via_otp():
    _reset_auth_stores()
    client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Trần Bảo Ngọc",
            "phone_number": "0934567890",
            "password": "OldPassword1",
            "school_level": "THCS",
            "class_name": "8A2",
            "student_code": "HS-8A2-12",
        },
    )
    first_login = client.post(
        "/api/v1/auth/student/login",
        json={"phone_number": "0934567890", "password": "OldPassword1"},
    )
    assert first_login.status_code == 200
    old_refresh = first_login.json()["refresh_token"]

    req_otp = client.post("/api/v1/auth/forgot-password/request-otp", json={"phone_number": "0934567890"})
    assert req_otp.status_code == 200
    otp_code = req_otp.json()["dev_otp_code"]

    # Sai OTP
    bad_reset = client.post(
        "/api/v1/auth/forgot-password/reset",
        json={"phone_number": "0934567890", "otp_code": "000000", "new_password": "NewPassword2"},
    )
    assert bad_reset.status_code == 400

    # Đúng OTP -> đổi mật khẩu & thu hồi refresh token cũ
    ok_reset = client.post(
        "/api/v1/auth/forgot-password/reset",
        json={"phone_number": "0934567890", "otp_code": otp_code, "new_password": "NewPassword2"},
    )
    assert ok_reset.status_code == 200
    assert ok_reset.json()["revoked_sessions"] >= 1

    old_pw_fail = client.post(
        "/api/v1/auth/student/login",
        json={"phone_number": "0934567890", "password": "OldPassword1"},
    )
    assert old_pw_fail.status_code == 401

    new_pw_ok = client.post(
        "/api/v1/auth/student/login",
        json={"phone_number": "0934567890", "password": "NewPassword2"},
    )
    assert new_pw_ok.status_code == 200

    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert replay.status_code == 401


def test_student_class_scoped_access_control():
    _reset_auth_stores()
    in_memory_snapshots.clear()

    # Lưu 2 bài giảng của lớp 10A1 và 10A2
    img = _tiny_png_b64()
    client.post(
        "/api/v1/sessions/snapshots",
        json={"session_id": "s-10a1", "room_id": "room-10a1", "class_name": "10A1", "subject": "TOAN", "image_base64": img},
    )
    client.post(
        "/api/v1/sessions/snapshots",
        json={"session_id": "s-10a2", "room_id": "room-10a2", "class_name": "10A2", "subject": "VAT_LY", "image_base64": img},
    )

    hs_10a1 = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Học sinh 10A1",
            "phone_number": "0977111222",
            "password": "Pass10A1!",
            "school_level": "THPT",
            "class_name": "10A1",
            "student_code": "HS-10A1-99",
        },
    ).json()
    headers_10a1 = {"Authorization": f"Bearer {hs_10a1['access_token']}"}

    # Chỉ thấy bài của lớp 10A1 khi gọi lessons hoặc /snapshots
    lessons = client.get("/api/v1/auth/student/lessons", headers=headers_10a1)
    assert lessons.status_code == 200
    assert lessons.json()["count"] == 1
    assert lessons.json()["items"][0]["tags"]["class_name"] == "10A1"

    snaps_auto = client.get("/api/v1/sessions/snapshots", headers=headers_10a1)
    assert snaps_auto.status_code == 200
    assert snaps_auto.json()["count"] == 1
    assert snaps_auto.json()["items"][0]["tags"]["class_name"] == "10A1"

    # Cố tình xem bài hoặc phòng của lớp 10A2 -> bị chặn 403 Forbidden
    forbidden_lessons = client.get("/api/v1/auth/student/lessons?class_name=10A2", headers=headers_10a1)
    assert forbidden_lessons.status_code == 403

    forbidden_snaps = client.get("/api/v1/sessions/snapshots?class_name=10A2", headers=headers_10a1)
    assert forbidden_snaps.status_code == 403

    forbidden_room = client.get("/api/v1/sessions/pages/room-10a2/s-10a2", headers=headers_10a1)
    assert forbidden_room.status_code == 403

    allowed_room = client.get("/api/v1/sessions/pages/room-10a1/s-10a1", headers=headers_10a1)
    assert allowed_room.status_code == 200
