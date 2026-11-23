import uuid
import pytest
from app.ai.gemini_service import gemini_service
from app.core.config import settings
from app.core.database import in_memory_login_failures, in_memory_otp_cooldowns, in_memory_users
from app.core.security import create_access_token


@pytest.fixture(autouse=True)
def mock_gemini_configured_for_tests(monkeypatch):
    """
    Đảm bảo các bài kiểm thử tự động (Unit / Integration Tests) chạy
    trên Mock Engine nội bộ để đảm bảo tốc độ (< 2.0s) và tính ổn định độc lập mạng.
    """
    monkeypatch.setattr(gemini_service, "is_configured", False)


@pytest.fixture(autouse=True)
def auth_security_test_isolation(request, monkeypatch):
    """
    Đợt 0 (N1, N2):
    - Xóa bộ đếm giới hạn tần suất đăng nhập / cooldown OTP giữa các test để chống nhiễm trạng thái.
    - Bật DEV_OTP_BYPASS duy nhất cho bài kiểm thử legacy `test_api.py::test_verify_otp`;
      mọi bài kiểm thử khác giữ nguyên mặc định `DEV_OTP_BYPASS = False`.
    """
    in_memory_login_failures.clear()
    in_memory_otp_cooldowns.clear()
    node_path = str(getattr(request.node, "path", getattr(request.node, "fspath", "")))
    if request.node.name == "test_verify_otp" and node_path.endswith("test_api.py"):
        monkeypatch.setattr(settings, "DEV_OTP_BYPASS", True)
    yield
    in_memory_login_failures.clear()
    in_memory_otp_cooldowns.clear()


@pytest.fixture
def make_auth_headers():
    """Factory tạo Bearer header cho TEACHER / ADMIN / STUDENT / PARENT (Đợt 3A)."""
    def _build(
        role: str = "TEACHER",
        *,
        full_name: str = "Giáo Viên Kiểm Thử",
        allowed_classes: list[str] | None = None,
        class_name: str | None = None,
    ) -> dict[str, str]:
        uid = f"test_{role.lower()}_{uuid.uuid4().hex[:8]}"
        classes = allowed_classes if allowed_classes is not None else (["*"] if role == "ADMIN" else ["10A1", "10A2"])
        in_memory_users[uid] = {
            "id": uid,
            "full_name": full_name,
            "email": f"{uid}@rikkei.edu.vn",
            "phone_number": "0909998887",
            "role": role,
            "password_hash": None,
            "school_level": "THPT",
            "class_name": class_name or (classes[0] if classes and classes[0] != "*" else None),
            "allowed_classes": classes,
            "student_code": f"STU_{uid[-4:].upper()}" if role in ("STUDENT", "PARENT") else None,
            "is_active": True,
        }
        tok = create_access_token(
            subject=uid,
            extra_claims={"role": role, "allowed_classes": classes, "class_name": class_name},
        )
        return {"Authorization": f"Bearer {tok}"}

    return _build


@pytest.fixture
def auth_headers(make_auth_headers) -> dict[str, str]:
    """Fixture Bearer header mặc định của Giáo viên dùng chung cho các bài kiểm thử Đợt 3."""
    return make_auth_headers("TEACHER")
