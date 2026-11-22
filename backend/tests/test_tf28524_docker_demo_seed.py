from io import BytesIO
from pathlib import Path
import re
from PIL import Image
from fastapi.testclient import TestClient

from app.core.security import verify_password
from app.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_docker_compose_dockerfile_and_nginx_packaging():
    """TF28524: Kiểm tra cấu hình đóng gói chung Frontend, FastAPI, PostgreSQL, Redis, MinIO."""
    compose_text = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    for required_token in [
        "postgres:16-alpine",
        "redis:7-alpine",
        "minio/minio",
        "minio-init:",
        "backend:",
        "frontend:",
        "nginx:1.27-alpine",
        "./docs/database_schema.sql:/docker-entrypoint-initdb.d/01_schema.sql:ro",
        "./docs/seed_demo_data.sql:/docker-entrypoint-initdb.d/02_seed_demo_data.sql:ro",
        "./frontend:/frontend:ro",
        "./frontend:/usr/share/nginx/html:ro",
        "SEED_DEMO_ON_STARTUP",
    ]:
        assert required_token in compose_text, f"Thiếu cấu hình '{required_token}' trong docker-compose.yml"

    dockerfile_text = (REPO_ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    assert "HEALTHCHECK" in dockerfile_text
    assert "uvicorn" in dockerfile_text

    reqs_text = (REPO_ROOT / "backend" / "requirements.txt").read_text(encoding="utf-8")
    assert "psycopg2-binary" in reqs_text
    assert "python-dotenv" in reqs_text

    nginx_conf = (REPO_ROOT / "docker" / "nginx" / "default.conf").read_text(encoding="utf-8")
    assert "proxy_pass http://backend:8000/api/;" in nginx_conf
    assert "proxy_pass http://backend:8000/ws/;" in nginx_conf
    assert "Upgrade $http_upgrade" in nginx_conf


def test_sql_seed_file_integrity_and_real_password_hashes():
    """TF28524: Kiểm tra file docs/seed_demo_data.sql khớp schema PostgreSQL 16+ và băm mật khẩu thật."""
    sql_text = (REPO_ROOT / "docs" / "seed_demo_data.sql").read_text(encoding="utf-8")

    for table in [
        "schools",
        "users",
        "classes",
        "class_enrollments",
        "teaching_sessions",
        "board_pages",
        "snapshots",
        "score_bonus_logs",
        "ai_usage_logs",
        "demo_exam_bank",
    ]:
        assert f"INSERT INTO {table}" in sql_text, f"Thiếu INSERT INTO {table} trong seed_demo_data.sql"

    assert sql_text.count("ON CONFLICT") >= 10
    for subj in ["'TOAN'", "'VAT_LY'", "'HOA_HOC'", "'TIENG_ANH'"]:
        assert subj in sql_text

    # Xác minh mã băm mật khẩu trong SQL là Bcrypt thật khớp đúng Admin@2026 & Demo@2026
    hashes = re.findall(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}", sql_text)
    assert len(hashes) >= 2
    assert any(verify_password("Admin@2026", h) for h in set(hashes))
    assert any(verify_password("Demo@2026", h) for h in set(hashes))


def test_startup_lifespan_seeds_accounts_lessons_and_four_subject_exams():
    """TF28524: Khi khởi động FastAPI (lifespan), toàn bộ tài khoản lớp học & đề mẫu Toán-Lý-Hóa-Anh sẵn sàng."""
    with TestClient(app) as live_client:
        # 1. Endpoint tổng quan Demo
        overview = live_client.get("/api/v1/demo/overview")
        assert overview.status_code == 200
        ov_data = overview.json()
        assert ov_data["status"] == "ready"
        assert set(ov_data["available_exam_subjects"]) == {"TOAN", "VAT_LY", "HOA_HOC", "TIENG_ANH"}
        assert ov_data["counts"]["schools"] >= 3
        assert ov_data["counts"]["classes"] >= 4
        assert ov_data["counts"]["snapshots"] >= 6

        # 2. Đăng nhập tài khoản Admin tạo sẵn -> kiểm tra Dashboard có dữ liệu ngay
        admin_login = live_client.post(
            "/api/v1/admin/login",
            json={"email": "admin@aicanvas.edu.vn", "password": "Admin@2026"},
        )
        assert admin_login.status_code == 200
        admin_tok = admin_login.json()["access_token"]
        admin_ov = live_client.get(
            "/api/v1/admin/stats",
            headers={"Authorization": f"Bearer {admin_tok}"},
        )
        assert admin_ov.status_code == 200
        assert admin_ov.json()["summary"]["total_schools"] >= 3
        assert admin_ov.json()["summary"]["total_classes"] >= 4
        assert admin_ov.json()["summary"]["total_teachers"] >= 3

        # 3. Đăng nhập Giáo viên tạo sẵn bằng mật khẩu
        teacher_login = live_client.post(
            "/api/v1/auth/teacher/login-password",
            json={"email": "gv.toan@aicanvas.edu.vn", "password": "Demo@2026"},
        )
        assert teacher_login.status_code == 200
        assert "10A1" in teacher_login.json()["allowed_classes"]

        # 4. Đăng nhập Học sinh lớp 10A1 -> thấy đủ ảnh bảng 4 môn Toán, Lý, Hóa, Anh & tải được ảnh nét cao
        stu_10a1 = live_client.post(
            "/api/v1/auth/student/login",
            json={"phone_number": "0912000101", "password": "Demo@2026"},
        )
        assert stu_10a1.status_code == 200
        stu_10a1_headers = {"Authorization": f"Bearer {stu_10a1.json()['access_token']}"}

        lessons_10a1 = live_client.get("/api/v1/auth/student/lessons", headers=stu_10a1_headers)
        assert lessons_10a1.status_code == 200
        subjects_seen = {item["tags"]["subject"] for item in lessons_10a1.json()["items"]}
        assert {"TOAN", "VAT_LY", "HOA_HOC", "TIENG_ANH"}.issubset(subjects_seen)

        img_res = live_client.get("/api/v1/sessions/snapshots/demo-snap-10a1-hoahoc/image?format=png")
        assert img_res.status_code == 200
        decoded_img = Image.open(BytesIO(img_res.content))
        assert decoded_img.size == (960, 540)

        # 5. Đăng nhập Học sinh lớp 8A2 & Phụ huynh lớp 4A1 -> phân quyền cô lập đúng lớp
        stu_8a2 = live_client.post(
            "/api/v1/auth/student/login",
            json={"phone_number": "0912000802", "password": "Demo@2026"},
        )
        assert stu_8a2.status_code == 200
        stu_8a2_headers = {"Authorization": f"Bearer {stu_8a2.json()['access_token']}"}
        blocked = live_client.get(
            "/api/v1/auth/student/lessons",
            params={"class_name": "10A1"},
            headers=stu_8a2_headers,
        )
        assert blocked.status_code == 403

        parent_4a1 = live_client.post(
            "/api/v1/auth/student/login",
            json={"phone_number": "0912000401", "password": "Demo@2026"},
        )
        assert parent_4a1.status_code == 200
        assert parent_4a1.json()["role"] == "PARENT"
        assert parent_4a1.json()["allowed_classes"] == ["4A1"]


def test_four_subject_demo_exams_and_file_upload():
    """TF28524: Kiểm tra bộ đề mẫu Toán, Lý, Hóa, Anh qua cả /api/v1/exam/sample, /api/v1/demo/exams và upload file."""
    with TestClient(app) as live_client:
        for subject in ["TOAN", "VAT_LY", "HOA_HOC", "TIENG_ANH"]:
            # Lấy qua endpoint chuẩn của bảng vẽ
            sample_res = live_client.get("/api/v1/exam/sample", params={"subject": subject, "mode": "STUDENT"})
            assert sample_res.status_code == 200
            s_data = sample_res.json()
            assert s_data["total_questions"] >= 3
            assert s_data["hidden_answers"] is True

            # Lấy qua endpoint ngân hàng đề Demo (chế độ TEACHER xem đủ đáp án)
            demo_res = live_client.get(f"/api/v1/demo/exams/{subject}", params={"mode": "TEACHER"})
            assert demo_res.status_code == 200
            d_data = demo_res.json()
            assert d_data["total_questions"] >= 4
            mcq_questions = [q for q in d_data["questions"] if q["question_type"] == "MCQ"]
            assert len(mcq_questions) >= 3
            first_mcq = mcq_questions[0]
            assert first_mcq["correct_option"] in ("A", "B", "C", "D")

            # Chấm thử ở chế độ Học sinh (ẩn correct_label) vẫn khớp đáp án thật
            stu_res = live_client.get(f"/api/v1/demo/exams/{subject}", params={"mode": "STUDENT"})
            stu_first_q = stu_res.json()["questions"][0]
            assert stu_first_q["correct_option"] is None
            grade_res = live_client.post(
                "/api/v1/exam/grade-mcq",
                json={
                    "question_id": stu_first_q["id"],
                    "selected_label": first_mcq["correct_option"],
                    "correct_label": None,
                    "subject": subject,
                },
            )
            assert grade_res.status_code == 200
            assert grade_res.json()["is_correct"] is True

        # Kiểm tra tải trực tiếp 4 tệp đề mẫu trong docs/demo_exams lên /api/v1/exam/upload
        exam_files = [
            "de_mau_toan_10a1.txt",
            "de_mau_vat_ly_10a1.txt",
            "de_mau_hoa_hoc_10a1.txt",
            "de_mau_tieng_anh_10a1.txt",
        ]
        for fname in exam_files:
            fpath = REPO_ROOT / "docs" / "demo_exams" / fname
            assert fpath.is_file(), f"Thiếu file đề mẫu {fname}"
            up_res = live_client.post(
                "/api/v1/exam/upload?mode=STUDENT",
                files={"file": (fname, fpath.read_bytes(), "text/plain")},
            )
            assert up_res.status_code == 200
            assert up_res.json()["total_questions"] == 4
