import pytest
from app.ai.gemini_service import gemini_service


@pytest.fixture(autouse=True)
def mock_gemini_configured_for_tests(monkeypatch):
    """
    Đảm bảo các bài kiểm thử tự động (Unit / Integration Tests) chạy
    trên Mock Engine nội bộ để đảm bảo tốc độ (< 2.0s) và tính ổn định độc lập mạng.
    """
    monkeypatch.setattr(gemini_service, "is_configured", False)
