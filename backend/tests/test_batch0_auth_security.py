from fastapi.testclient import TestClient

from app.api.admin_router import _ensure_default_admin
from app.core.config import settings
from app.core.database import (
    in_memory_login_failures,
    in_memory_otp_cooldowns,
    in_memory_otps,
    in_memory_users,
)
from app.core.security import verify_password
from app.main import app

client = TestClient(app)


def test_n1_dev_otp_bypass_default_off_rejects_magic_code():
    """N1: Mặc định DEV_OTP_BYPASS=False phải từ chối mã '123456' cả khi chưa lẫn đã yêu cầu OTP."""
    assert settings.DEV_OTP_BYPASS is False

    no_req = client.post(
        "/api/v1/auth/verify-otp",
        json={"email": "new.n1.user@rikkei.edu.vn", "phone_number": "0977000111", "otp_code": "123456"},
    )
    assert no_req.status_code == 400

    req = client.post(
        "/api/v1/auth/request-otp",
        json={"email": "new.n1.user@rikkei.edu.vn", "phone_number": "0977000111", "role": "TEACHER"},
    )
    assert req.status_code == 200
    real_code = req.json()["dev_otp_code"]

    if real_code != "123456":
        magic_attempt = client.post(
            "/api/v1/auth/verify-otp",
            json={"email": "new.n1.user@rikkei.edu.vn", "phone_number": "0977000111", "otp_code": "123456"},
        )
        assert magic_attempt.status_code == 400


def test_n1_bypass_never_hijacks_existing_or_admin_and_never_sets_password(monkeypatch):
    """N1: Kể cả khi bật DEV_OTP_BYPASS=True, không bao giờ áp dụng cho tài khoản đã tồn tại/Admin và không ghi mật khẩu."""
    admin = _ensure_default_admin()
    original_admin_hash = admin["password_hash"]

    # Đăng ký sẵn một tài khoản Giáo viên hợp lệ
    reg_teacher = client.post(
        "/api/v1/auth/teacher/register",
        json={
            "full_name": "Cô Lan Giáo Viên",
            "email": "colan.n1@rikkei.edu.vn",
            "phone_number": "0977000222",
            "password": "OriginalTeacherPassword!1",
        },
    )
    assert reg_teacher.status_code == 200
    teacher_id = reg_teacher.json()["id"]
    original_teacher_hash = in_memory_users[teacher_id]["password_hash"]

    monkeypatch.setattr(settings, "DEV_OTP_BYPASS", True)

    # 1. Thử chiếm tài khoản Admin qua email hoặc SĐT của Admin -> bắt buộc bị chặn 403/400
    hijack_admin_by_email = client.post(
        "/api/v1/auth/verify-otp",
        json={
            "email": admin["email"],
            "phone_number": admin["phone_number"],
            "otp_code": "123456",
            "password": "HackedPassword!999",
        },
    )
    assert hijack_admin_by_email.status_code == 403
    assert in_memory_users[admin["id"]]["password_hash"] == original_admin_hash

    hijack_admin_by_phone = client.post(
        "/api/v1/auth/verify-otp",
        json={
            "email": "attacker@evil.example",
            "phone_number": admin["phone_number"],
            "otp_code": "123456",
            "password": "HackedPassword!999",
        },
    )
    assert hijack_admin_by_phone.status_code == 403

    # 2. Thử chiếm tài khoản Giáo viên đã tồn tại bằng mã bypass 123456 -> bắt buộc bị từ chối 400
    hijack_existing_teacher = client.post(
        "/api/v1/auth/verify-otp",
        json={
            "email": "colan.n1@rikkei.edu.vn",
            "phone_number": "0977000222",
            "otp_code": "123456",
            "password": "HackedPassword!999",
        },
    )
    assert hijack_existing_teacher.status_code == 400
    assert in_memory_users[teacher_id]["password_hash"] == original_teacher_hash
    assert verify_password("OriginalTeacherPassword!1", in_memory_users[teacher_id]["password_hash"])

    # 3. Thử gửi email kẻ tấn công kèm SĐT của Giáo viên đã tồn tại để nhận OTP -> bị chặn 400
    mismatched_otp_req = client.post(
        "/api/v1/auth/request-otp",
        json={
            "email": "attacker2@evil.example",
            "phone_number": "0977000222",
            "role": "TEACHER",
        },
    )
    assert mismatched_otp_req.status_code == 400

    # 4. Với tài khoản hoàn toàn mới khi DEV_OTP_BYPASS=True: đăng nhập dev được nhưng KHÔNG lưu password chưa xác thực OTP thật
    bypass_new = client.post(
        "/api/v1/auth/verify-otp",
        json={
            "email": "brandnew.dev@rikkei.edu.vn",
            "phone_number": "0977000333",
            "otp_code": "123456",
            "password": "UnverifiedPassword!123",
        },
    )
    assert bypass_new.status_code == 200
    created_uid = bypass_new.json()["user_id"]
    assert in_memory_users[created_uid]["password_hash"] is None


def test_n2_request_otp_cooldown_and_preserve_attempts_while_valid(monkeypatch):
    """N2: Cooldown chống spam gửi OTP liên tiếp & không reset attempts về 0 khi OTP cũ còn hiệu lực."""
    email = "ratelimit.otp@rikkei.edu.vn"
    phone = "0977000444"
    monkeypatch.setattr(settings, "OTP_REQUEST_COOLDOWN_SECONDS", 30)

    first = client.post(
        "/api/v1/auth/request-otp",
        json={"email": email, "phone_number": phone, "role": "TEACHER"},
    )
    assert first.status_code == 200

    # Gọi lại ngay lập tức trong thời gian cooldown -> 429 Too Many Requests
    spam = client.post(
        "/api/v1/auth/request-otp",
        json={"email": email, "phone_number": phone, "role": "TEACHER"},
    )
    assert spam.status_code == 429
    assert "Retry-After" in spam.headers

    # Giả lập đã hết thời gian cooldown (nhưng OTP 300s vẫn còn hạn): nhập sai 3 lần rồi xin lại OTP
    in_memory_otp_cooldowns.clear()
    in_memory_login_failures.clear()
    for _ in range(3):
        bad = client.post(
            "/api/v1/auth/verify-otp",
            json={"email": email, "phone_number": phone, "otp_code": "000000"},
        )
        assert bad.status_code == 400

    key = f"LOGIN:{email}:{phone}"
    assert in_memory_otps[key]["attempts"] == 3

    reissued = client.post(
        "/api/v1/auth/request-otp",
        json={"email": email, "phone_number": phone, "role": "TEACHER"},
    )
    assert reissued.status_code == 200
    # attempts phải giữ nguyên = 3 (KHÔNG bị reset về 0)
    assert in_memory_otps[key]["attempts"] == 3

    # Thử sai thêm 2 lần nữa là chạm trần 5 lần -> 429
    res_4 = client.post(
        "/api/v1/auth/verify-otp",
        json={"email": email, "phone_number": phone, "otp_code": "000000"},
    )
    assert res_4.status_code == 400
    res_5 = client.post(
        "/api/v1/auth/verify-otp",
        json={"email": email, "phone_number": phone, "otp_code": "000000"},
    )
    assert res_5.status_code == 429


def test_n2_password_login_rate_limiting_teacher_student_and_admin(monkeypatch):
    """N2: Giới hạn số lần đăng nhập sai mật khẩu kèm khóa tạm thời (429 + Retry-After)."""
    monkeypatch.setattr(settings, "LOGIN_RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILED_ATTEMPTS", 3)
    monkeypatch.setattr(settings, "LOGIN_LOCKOUT_BASE_SECONDS", 20)

    _ensure_default_admin()
    client.post(
        "/api/v1/auth/teacher/register",
        json={
            "full_name": "Thầy Minh",
            "email": "thayminh.n2@rikkei.edu.vn",
            "phone_number": "0977000555",
            "password": "CorrectPassword!1",
        },
    )
    client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Em An",
            "phone_number": "0977000666",
            "password": "StudentPassword!1",
            "school_level": "THPT",
            "class_name": "10A1",
            "student_code": "HS10A1_N2_01",
        },
    )

    # 1. Giáo viên sai mật khẩu 3 lần -> lần thứ 4 (kể cả mật khẩu đúng) bị tạm khóa 429
    for _ in range(3):
        r = client.post(
            "/api/v1/auth/teacher/login-password",
            json={"email": "thayminh.n2@rikkei.edu.vn", "password": "WrongPassword"},
        )
        assert r.status_code == 401

    locked_teacher = client.post(
        "/api/v1/auth/teacher/login-password",
        json={"email": "thayminh.n2@rikkei.edu.vn", "password": "CorrectPassword!1"},
    )
    assert locked_teacher.status_code == 429
    assert int(locked_teacher.headers["Retry-After"]) >= 1

    # 2. Học sinh sai mật khẩu 3 lần -> lần thứ 4 bị tạm khóa 429
    for _ in range(3):
        r = client.post(
            "/api/v1/auth/student/login",
            json={"phone_number": "0977000666", "password": "WrongPassword"},
        )
        assert r.status_code == 401

    locked_student = client.post(
        "/api/v1/auth/student/login",
        json={"phone_number": "0977000666", "password": "StudentPassword!1"},
    )
    assert locked_student.status_code == 429

    # 3. Admin sai mật khẩu 3 lần -> lần thứ 4 bị tạm khóa 429
    for _ in range(3):
        r = client.post(
            "/api/v1/admin/login",
            json={"email": settings.ADMIN_EMAIL, "password": "WrongAdminPassword"},
        )
        assert r.status_code == 401

    locked_admin = client.post(
        "/api/v1/admin/login",
        json={"email": settings.ADMIN_EMAIL, "password": settings.ADMIN_PASSWORD},
    )
    assert locked_admin.status_code == 429
