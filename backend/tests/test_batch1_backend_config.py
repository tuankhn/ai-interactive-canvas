from pathlib import Path
import xml.etree.ElementTree as ET
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.illustration_service import illustration_service

client = TestClient(app)


def test_c11_path_traversal_blocked_while_spa_fallback_preserved():
    """C11: Chặn thoát ra ngoài FRONTEND_DIR qua '%2e%2e/' nhưng vẫn phục vụ asset tĩnh và SPA fallback."""
    traversal_dotdot = client.get("/%2e%2e/backend/.env.example")
    assert traversal_dotdot.status_code == 404

    traversal_nested = client.get("/src/%2e%2e/%2e%2e/backend/requirements.txt")
    assert traversal_nested.status_code == 404

    # Với đường dẫn đã bị client chuẩn hóa thành '/backend/requirements.txt', chỉ trả SPA index.html chứ tuyệt đối không lộ nội dung requirements.txt
    normalized_req = client.get("/src/../../backend/requirements.txt")
    assert "psycopg2-binary" not in normalized_req.text

    # Asset tĩnh hợp lệ & SPA fallback vẫn hoạt động bình thường
    app_js = client.get("/app.js")
    assert app_js.status_code == 200
    spa_route = client.get("/classroom/board-view")
    assert spa_route.status_code == 200
    assert "aiOverlayPanel" in spa_route.text


def test_c10_cors_wildcard_does_not_enable_credentials():
    """C10: Khi allow_origins=['*'], không bật allow-credentials với wildcard."""
    res = client.options(
        "/health",
        headers={
            "Origin": "https://example.edu.vn",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-credentials") != "true"


def test_c2_m11_gemini_model_config_and_provider_labels():
    """C2/M11: Mặc định gemini-3.5-flash, có GEMINI_FALLBACK_MODELS và .env.example đồng bộ."""
    repo_root = Path(__file__).resolve().parents[2]
    env_example = (repo_root / "backend" / ".env.example").read_text(encoding="utf-8")
    assert 'GEMINI_MODEL="gemini-3.5-flash"' in env_example
    assert isinstance(settings.GEMINI_FALLBACK_MODELS, list)
    assert len(settings.GEMINI_FALLBACK_MODELS) >= 1

    providers = client.get("/api/v1/recognize/providers")
    assert providers.status_code == 200
    gem_info = providers.json()["gemini"]
    assert gem_info["model"] == settings.GEMINI_MODEL
    assert settings.GEMINI_MODEL in gem_info["name"]


def test_h15_backend_svg_escapes_special_characters_after_truncation():
    """H15-backend: Ký tự '<', '>', '&', '\"' trong concept/subject được escape thành XML hợp lệ, không gãy thực thể khi cắt chuỗi."""
    malicious_concept = "A&B<script>alert(1)</script>1234567890"
    malicious_subject = 'ENG"><img src=x onerror=1>'
    illu = illustration_service.generate_chalk_illustration(malicious_concept, subject=malicious_subject)

    assert "<script>" not in illu.svg_content
    assert "<img" not in illu.svg_content
    # Phải parse được như một tài liệu XML hoàn chỉnh không lỗi cú pháp
    root = ET.fromstring(illu.svg_content)
    assert root.tag.endswith("svg")
