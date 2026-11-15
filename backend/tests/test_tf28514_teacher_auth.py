from fastapi.testclient import TestClient

from app.core.database import (
    in_memory_otps,
    in_memory_refresh_sessions,
    in_memory_users,
)
from app.core.security import decode_token, get_password_hash, verify_password
from app.main import app

client = TestClient(app)


def test_teacher_otp_email_14_day_classroom_session_flow():
    email = "teacher.khang@rikkei.edu.vn"
    phone = "0912345678"
    in_memory_otps.clear()

    # 1. Yêu cầu gửi OTP bắt buộc có cả Email và SĐT cho Giáo viên
    bad_req = client.post(
        "/api/v1/auth/request-otp",
        json={"phone_number": phone, "role": "TEACHER"},
    )
    assert bad_req.status_code == 422

    req = client.post(
        "/api/v1/auth/request-otp",
        json={"email": email, "phone_number": phone, "role": "TEACHER", "full_name": "Nguyễn Tuấn Khang"},
    )
    assert req.status_code == 200
    req_data = req.json()
    assert req_data["success"] is True
    otp_code = req_data["dev_otp_code"]
    assert len(otp_code) == 6 and otp_code.isdigit()

    # 2. Nhập sai OTP -> báo lỗi 400 (không chấp nhận mã bừa)
    wrong = client.post(
        "/api/v1/auth/verify-otp",
        json={"email": email, "phone_number": phone, "otp_code": "000000"},
    )
    assert wrong.status_code == 400

    # 3. Nhập đúng OTP 6 số -> cấp Access Token + Refresh Token duy trì 14 ngày trên thiết bị phòng học
    verify = client.post(
        "/api/v1/auth/verify-otp",
        json={
            "email": email,
            "phone_number": phone,
            "otp_code": otp_code,
            "remember_me": True,
            "device_id": "smartboard-p302",
            "password": "Teacher@2026!",
        },
    )
    assert verify.status_code == 200
    tok = verify.json()
    assert tok["role"] == "TEACHER"
    assert tok["remember_days"] == 14
    assert tok["refresh_expires_in"] == 14 * 86400
    assert tok["device_id"] == "smartboard-p302"

    refresh_claims = decode_token(tok["refresh_token"], expected_type="refresh")
    assert refresh_claims["device_id"] == "smartboard-p302"
    assert refresh_claims["jti"] in in_memory_refresh_sessions

    # 4. Kiểm tra /me bằng Access Token
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == email
    assert me.json()["device_id"] == "smartboard-p302"

    # 5. Làm mới phiên (Refresh Token Rotation) & từ chối thiết bị lạ
    wrong_dev = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tok["refresh_token"], "device_id": "other-room-pc"},
    )
    assert wrong_dev.status_code == 401

    refreshed = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tok["refresh_token"], "device_id": "smartboard-p302"},
    )
    assert refreshed.status_code == 200
    new_tok = refreshed.json()
    assert new_tok["refresh_token"] != tok["refresh_token"]

    # Token cũ sau khi rotation bị từ chối
    replay = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tok["refresh_token"], "device_id": "smartboard-p302"},
    )
    assert replay.status_code == 401

    # 6. Đăng xuất thu hồi phiên thiết bị
    out = client.post("/api/v1/auth/logout", json={"refresh_token": new_tok["refresh_token"]})
    assert out.status_code == 200
    assert out.json()["revoked_sessions"] >= 1


def test_teacher_password_hashing_argon2_or_bcrypt():
    in_memory_users.clear()
    email = "gv.hoa@rikkei.edu.vn"
    phone = "+84 988 777 666"
    raw_pw = "HoaHoc@2026"

    reg = client.post(
        "/api/v1/auth/teacher/register",
        json={"full_name": "Cô Lan Hóa", "email": email, "phone_number": phone, "password": raw_pw},
    )
    assert reg.status_code == 200
    user_data = reg.json()
    assert user_data["password_hash_scheme"] in ("argon2", "bcrypt", "pbkdf2_sha256")

    stored = in_memory_users[user_data["id"]]
    assert stored["password_hash"] != raw_pw
    assert verify_password(raw_pw, stored["password_hash"]) is True
    assert verify_password("WrongPass!", stored["password_hash"]) is False

    # Kiểm tra helper băm BCrypt trực tiếp và login bằng mật khẩu
    bcrypt_hash = get_password_hash(raw_pw, scheme="bcrypt")
    assert bcrypt_hash.startswith("$2")
    assert verify_password(raw_pw, bcrypt_hash) is True

    login = client.post(
        "/api/v1/auth/teacher/login-password",
        json={"email": email, "password": raw_pw, "remember_me": True, "device_id": "smartboard-lab1"},
    )
    assert login.status_code == 200
    assert login.json()["remember_days"] == 14


def test_teacher_login_frontend_ui_served():
    html = client.get("/").text
    assert 'id="teacherLoginDialog"' in html
    assert 'id="teacherOtpRequestForm"' in html
    assert 'id="teacherOtpVerifyForm"' in html
    assert 'autocomplete="one-time-code"' in html

    js = client.get("/src/utils/auth_client.js").text
    assert "/api/v1/auth/request-otp" in js
    assert "/api/v1/auth/verify-otp" in js
    assert "/api/v1/auth/refresh" in js
