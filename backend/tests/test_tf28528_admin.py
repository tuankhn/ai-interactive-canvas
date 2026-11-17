import base64
from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import (
    in_memory_ai_quotas,
    in_memory_ai_usage_logs,
    in_memory_classes,
    in_memory_otps,
    in_memory_refresh_sessions,
    in_memory_schools,
    in_memory_snapshots,
    in_memory_student_bindings,
    in_memory_users,
)
from app.main import app

client = TestClient(app)


def _tiny_png_b64() -> str:
    img = Image.new("RGB", (96, 96), color=(255, 255, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def _reset_admin_stores():
    in_memory_users.clear()
    in_memory_student_bindings.clear()
    in_memory_otps.clear()
    in_memory_refresh_sessions.clear()
    in_memory_schools.clear()
    in_memory_classes.clear()
    in_memory_ai_usage_logs.clear()
    in_memory_snapshots.clear()
    in_memory_ai_quotas["gemini_limit"] = settings.GEMINI_MONTHLY_QUOTA
    in_memory_ai_quotas["mathpix_limit"] = settings.MATHPIX_MONTHLY_QUOTA
    in_memory_ai_quotas["minio_storage_limit_mb"] = settings.MINIO_STORAGE_QUOTA_MB


def _login_as_admin() -> str:
    res = client.post(
        "/api/v1/admin/login",
        json={"email": settings.ADMIN_EMAIL, "password": settings.ADMIN_PASSWORD},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["role"] == "ADMIN"
    return body["access_token"]


def test_admin_auth_and_rbac_blocks_non_admin():
    _reset_admin_stores()

    # Chưa đăng nhập bị chặn 401
    unauth = client.get("/api/v1/admin/stats")
    assert unauth.status_code == 401

    # Học sinh đăng nhập thử gọi API Admin bị chặn 403
    stu = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Học Sinh Kiểm Thử",
            "phone_number": "0911223344",
            "password": "Password123",
            "school_level": "THPT",
            "class_name": "10A1",
            "student_code": "HS-ADMIN-TEST",
        },
    )
    assert stu.status_code == 200
    stu_token = stu.json()["access_token"]

    forbidden = client.get(
        "/api/v1/admin/schools",
        headers={"Authorization": f"Bearer {stu_token}"},
    )
    assert forbidden.status_code == 403

    # Sai mật khẩu Admin bị từ chối 401
    bad_login = client.post(
        "/api/v1/admin/login",
        json={"email": settings.ADMIN_EMAIL, "password": "WrongPassword!"},
    )
    assert bad_login.status_code == 401

    # Đăng nhập đúng tài khoản Admin thành công
    token = _login_as_admin()
    ok = client.get("/api/v1/admin/schools", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200


def test_admin_school_class_teacher_provisioning_lifecycle():
    _reset_admin_stores()
    token = _login_as_admin()
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Tạo trường học
    sch_res = client.post(
        "/api/v1/admin/schools",
        headers=headers,
        json={
            "code": "thpt-lhp",
            "name": "THPT Lê Hồng Phong",
            "level": "THPT",
            "address": "Quận 5, TP.HCM",
        },
    )
    assert sch_res.status_code == 201
    school_id = sch_res.json()["school"]["id"]
    assert sch_res.json()["school"]["code"] == "THPT-LHP"

    # Trùng mã trường -> 409
    dup_sch = client.post(
        "/api/v1/admin/schools",
        headers=headers,
        json={"code": "THPT-LHP", "name": "Trùng Mã", "level": "THPT"},
    )
    assert dup_sch.status_code == 409

    # 2. Cấp tài khoản Giáo viên với mật khẩu tạm tự sinh
    teacher_res = client.post(
        "/api/v1/admin/teachers",
        headers=headers,
        json={
            "full_name": "Cô Phạm Ngọc Lan",
            "email": "lan.pham@aicanvas.edu.vn",
            "phone_number": "0988777666",
            "school_id": school_id,
            "assigned_classes": ["10A1"],
        },
    )
    assert teacher_res.status_code == 201
    teacher_data = teacher_res.json()
    teacher_id = teacher_data["teacher"]["id"]
    temp_pw = teacher_data["temporary_password"]
    assert len(temp_pw) >= 8

    # Giáo viên dùng ngay mật khẩu Admin vừa cấp để đăng nhập
    t_login = client.post(
        "/api/v1/auth/teacher/login-password",
        json={"email": "lan.pham@aicanvas.edu.vn", "password": temp_pw},
    )
    assert t_login.status_code == 200
    assert t_login.json()["role"] == "TEACHER"

    # 3. Tạo lớp học gắn trường & GV chủ nhiệm
    cls_res = client.post(
        "/api/v1/admin/classes",
        headers=headers,
        json={
            "school_id": school_id,
            "name": "10A2",
            "grade": 10,
            "academic_year": "2026-2027",
            "homeroom_teacher_id": teacher_id,
        },
    )
    assert cls_res.status_code == 201
    classroom = cls_res.json()["classroom"]
    assert classroom["homeroom_teacher_name"] == "Cô Phạm Ngọc Lan"
    assert classroom["room_id"] == "room-thpt-lhp-10a2"

    # GV được tự động đồng bộ thêm lớp 10A2 vào allowed_classes
    teachers_list = client.get("/api/v1/admin/teachers", headers=headers).json()["items"]
    assert set(teachers_list[0]["allowed_classes"]) == {"10A1", "10A2"}

    # Trùng lớp cùng trường & năm học -> 409
    dup_cls = client.post(
        "/api/v1/admin/classes",
        headers=headers,
        json={"school_id": school_id, "name": "10A2", "grade": 10, "academic_year": "2026-2027"},
    )
    assert dup_cls.status_code == 409

    # Khóa tài khoản GV -> bị từ chối đăng nhập mật khẩu
    lock_res = client.patch(
        f"/api/v1/admin/teachers/{teacher_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert lock_res.status_code == 200
    assert lock_res.json()["teacher"]["is_active"] is False

    locked_login = client.post(
        "/api/v1/auth/teacher/login-password",
        json={"email": "lan.pham@aicanvas.edu.vn", "password": temp_pw},
    )
    assert locked_login.status_code == 403


def test_admin_tracks_gemini_mathpix_and_minio_quota_stats():
    _reset_admin_stores()
    token = _login_as_admin()
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Gọi thực tế API nhận diện Gemini/Hybrid & Mathpix qua router AI
    img_b64 = _tiny_png_b64()
    gem_call = client.post(
        "/api/v1/recognize",
        json={"subject": "TIENG_ANH", "provider": "gemini", "image_base64": img_b64},
    )
    assert gem_call.status_code == 200

    mpx_call = client.post(
        "/api/v1/recognize",
        json={"subject": "TOAN", "provider": "mathpix", "image_base64": img_b64},
    )
    assert mpx_call.status_code == 200

    # 2. Lưu snapshot bảng để phát sinh dung lượng trên MinIO / snapshot ledger
    snap_call = client.post(
        "/api/v1/sessions/snapshots",
        json={
            "session_id": "sess-admin-1",
            "room_id": "room-10a1",
            "teacher_name": "Thầy Khang",
            "class_name": "10A1",
            "subject": "TOAN",
            "period_number": 1,
            "page_number": 1,
            "image_base64": img_b64,
        },
    )
    assert snap_call.status_code == 200

    # 3. Hạ hạn mức Gemini xuống 1 để kiểm tra cảnh báo CRITICAL
    quota_res = client.put(
        "/api/v1/admin/ai-quota",
        headers=headers,
        json={"gemini_limit": 1, "mathpix_limit": 50, "minio_storage_limit_mb": 200},
    )
    assert quota_res.status_code == 200

    # 4. Đọc thống kê Admin Stats
    stats_res = client.get("/api/v1/admin/stats", headers=headers)
    assert stats_res.status_code == 200
    stats = stats_res.json()

    assert stats["ai_usage"]["gemini"]["total_calls"] == 1
    assert stats["ai_usage"]["mathpix"]["total_calls"] == 1
    assert stats["summary"]["total_ai_calls"] == 2
    assert stats["summary"]["alert_level"] == "CRITICAL"

    assert stats["minio_storage"]["total_snapshots"] == 1
    assert stats["minio_storage"]["total_bytes"] > 0
    assert stats["minio_storage"]["by_class"]["10A1"]["snapshots"] == 1


def test_admin_html_page_served():
    res = client.get("/src/pages/admin.html")
    assert res.status_code == 200
    assert "Bảng Điều Khiển Quản Trị" in res.text
    assert "/api/v1/admin/stats" in res.text
