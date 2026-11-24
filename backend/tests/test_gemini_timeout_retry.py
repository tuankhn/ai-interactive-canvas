import asyncio
from pathlib import Path
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ai.gemini_service import GeminiAIService, gemini_service

client = TestClient(app)
DUMMY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


@pytest.mark.anyio
async def test_gemini_timeout_returns_clean_error_not_fake_parabola():
    """Khi Gemini đã cấu hình key nhưng bị TimeoutError, KHÔNG được trả về y = x^2 - 4x + 3."""
    service = GeminiAIService()
    service.is_configured = True
    service._client_type = "google-genai"
    service.model_name = "gemini-3.5-flash-lite"
    service.client = MagicMock()
    service.client.models.generate_content.side_effect = asyncio.TimeoutError()

    res = await service.analyze_board(DUMMY_PNG, subject="TOAN", timeout=6.0)

    assert res.recognized_text == ""
    assert res.latex == ""
    assert res.visualization is None
    assert "x^2 - 4x + 3" not in (res.explanation or "")
    assert res.subject_details is not None
    assert res.subject_details.get("status") == "error"
    assert res.subject_details.get("retryable") is True
    assert res.degraded_reason is not None


def test_api_recognize_does_not_leak_mock_graph_on_gemini_timeout(monkeypatch):
    """POST /api/v1/recognize không được sinh visualization 2D_GRAPH giả khi Gemini timeout."""
    monkeypatch.setattr(gemini_service, "is_configured", True)
    monkeypatch.setattr(gemini_service, "_client_type", "google-genai")
    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = asyncio.TimeoutError()
    monkeypatch.setattr(gemini_service, "client", mock_client)

    resp = client.post(
        "/api/v1/recognize",
        json={"image_base64": DUMMY_PNG, "subject": "TOAN", "provider": "gemini"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["recognized_text"] == ""
    assert data["latex"] == ""
    assert data["visualization"] is None
    assert data["illustration"] is None
    assert data["needs_correction"] is False
    assert data["subject_details"]["status"] == "error"
    assert data["subject_details"]["retryable"] is True
    assert "y = x^2 - 4x + 3" not in (data.get("explanation") or "")


@pytest.mark.anyio
async def test_gemini_transient_timeout_recovers_on_retry_and_frontend_exports_present():
    """Lần 1 bị TimeoutError tạm thời -> retry có backoff thành công ở lần 2; kiểm tra Frontend UI/exports."""
    service = GeminiAIService()
    service.is_configured = True
    service._client_type = "google-genai"
    service.model_name = "gemini-3.5-flash-lite"

    attempts = {"count": 0}

    def flaky_generate(*, model, contents, config=None):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise asyncio.TimeoutError()
        ok_resp = MagicMock()
        ok_resp.text = '{"recognized_text": "3x - 9 = 0", "latex": "3x - 9 = 0", "subject": "TOAN", "confidence": 0.99}'
        return ok_resp

    service.client = MagicMock()
    service.client.models.generate_content.side_effect = flaky_generate

    res = await service.analyze_board(DUMMY_PNG, subject="TOAN", timeout=12.0)
    assert attempts["count"] == 2
    assert res.recognized_text == "3x - 9 = 0"
    assert res.degraded_reason is None

    repo_root = Path(__file__).resolve().parents[2]
    index_html = (repo_root / "frontend" / "index.html").read_text(encoding="utf-8")
    ai_js = (repo_root / "frontend" / "src" / "components" / "aiRecognition.js").read_text(encoding="utf-8")

    for required_id in ["btnReanalyzeBoard", "aiErrorBanner", "retryAiErrorBtn", "rescanBoardErrorBtn"]:
        assert required_id in index_html
    for required_fn in ["export async function retryAIRecognition", "export async function reanalyzeCurrentCanvas"]:
        assert required_fn in ai_js


def test_frontend_auto_replaces_handwriting_strokes_on_insert():
    """Đảm bảo insertAiResultToBoard() tự động xóa nét Path cũ và chèn đúng vị trí thay vì hardcode (40, 40)."""
    repo_root = Path(__file__).resolve().parents[2]
    ai_js = (repo_root / "frontend" / "src" / "components" / "aiRecognition.js").read_text(encoding="utf-8")

    assert "import { Text, FabricImage, Path }" in ai_js
    assert "let recognizedStrokeObjects = [];" in ai_js
    assert "function mapPreprocessBoxToCanvas(preprocess)" in ai_js
    assert "function resolveStrokesAndRegionForReplacement(aiResult)" in ai_js
    assert "fabricCanvas.remove(...strokesToRemove);" in ai_js

    insert_section = ai_js.split("export async function insertAiResultToBoard()", 1)[1].split(
        "export function initBoardWebSocket()", 1
    )[0]
    assert "left: region.left" in insert_section
    assert "top: region.top" in insert_section
    assert "left: 40" not in insert_section
    assert "top: 40" not in insert_section

