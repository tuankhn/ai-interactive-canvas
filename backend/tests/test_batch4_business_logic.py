import math
import random
import re

from app.services.ai_recognition import ai_recognition_service
from app.services.exam_service import exam_service
from app.services.grading_service import grading_service
from app.services.question_generator_service import question_variant_service


def test_h13_answer_key_regex_ignores_solution_words_and_preserves_external_key():
    """H13: Không bắt nhầm chữ đầu của từ sau 'Lời giải:' / 'Key: dependency' và không ghi đè external_key."""
    raw = (
        "Câu 1: Nghiệm của phương trình x - 2 = 0 là:\n"
        "A. x = 1\n"
        "B. x = 3\n"
        "C. x = 2\n"
        "D. x = 4\n"
        "Lời giải: Biến đổi phương trình ta được x = 2.\n\n"
        "Câu 2: Chọn từ đúng:\n"
        "A. depend\n"
        "B. dependent\n"
        "C. dependently\n"
        "D. dependency\n"
        "Key: dependency is a noun.\n"
        "Đáp án: A\n\n"
        "BẢNG ĐÁP ÁN:\n"
        "1: C\n"
    )
    parsed = exam_service.parse_text(raw)
    q1, q2 = parsed["questions"][0], parsed["questions"][1]
    assert q1["correct_option"] == "C"  # Bảng đáp án C không bị 'Lời giải: Biến đổi...' ghi đè thành B
    assert q2["correct_option"] == "A"  # 'Key: dependency' không bị bắt nhầm thành D


def test_h14_trig_step_grading_accepts_valid_identities_and_catches_real_errors():
    """H14: 5 biến đổi lượng giác đúng phải được chấm ĐÚNG; công thức sai vẫn phải báo SAI."""
    valid_steps = [
        "(sin x)' = cos x",
        "(sin(x))' = cos(x)",
        "(-cos x)' = sin x",
        "sin^2 x = 1 - cos^2 x",
        "1 - cos^2 x = sin^2 x",
    ]
    for idx, line in enumerate(valid_steps, start=1):
        res = grading_service.evaluate_essay_step(
            question_id="q_trig", step_number=idx, written_text=line, previous_steps=[]
        )
        assert res.is_step_correct is True, f"Báo sai oan cho bước đúng: {line} -> {res}"

    invalid_steps = [
        "y' = (sin x)' = -cos x",
        "(cos x)' = sin x",
        "sin^2 x + cos^2 x = 0",
        "sin^2 x - cos^2 x = 1",
    ]
    for idx, line in enumerate(invalid_steps, start=1):
        res = grading_service.evaluate_essay_step(
            question_id="q_trig", step_number=idx, written_text=line, previous_steps=[]
        )
        assert res.is_step_correct is False, f"Bỏ sót bước sai: {line}"


def test_h16_and_n9_quadratic_roots_order_and_advanced_vieta_answer():
    """H16 + N9: x_1 = (-b + sqrt(Delta))/(2a) phải khớp giá trị thực; kịch bản nâng cao #1 có nghiệm -1 ± sqrt(7)."""
    for seed in range(16):
        rng = random.Random(seed)
        item = question_variant_service._similar_quadratic("x^2 - 5x + 6 = 0", rng)
        guide = item.solution_guide

        m1 = re.search(r"x_1 = \(-b \+ sqrt\(Delta\)\) / \(2a\) = \(([-\d]+) \+ (\d+)\) / (\d+) = ([-\d]+)", guide)
        m2 = re.search(r"x_2 = \(-b - sqrt\(Delta\)\) / \(2a\) = \(([-\d]+) - (\d+)\) / (\d+) = ([-\d]+)", guide)
        assert m1 and m2, guide
        neg_b, sqrt_d, two_a, printed_x1 = map(int, m1.groups())
        _, _, _, printed_x2 = map(int, m2.groups())
        assert (neg_b + sqrt_d) // two_a == printed_x1
        assert (neg_b - sqrt_d) // two_a == printed_x2

    # N9: Kiểm tra toàn bộ kịch bản nâng cao bậc 2 không còn đáp án sai 'm = 0 hoặc m = -2'
    seen_answers = set()
    for seed in range(25):
        adv = question_variant_service._advanced_quadratic("x^2 - 5x + 6 = 0", random.Random(seed))
        seen_answers.add(adv.correct_answer)
        assert "m = 0 hoặc m = -2" not in adv.correct_answer
    assert any("7" in ans for ans in seen_answers)


def test_h4_math_visualization_extracts_actual_quadratic_expression():
    """H4: Hàm bậc hai thực tế phải trích đúng hệ số thay vì luôn trả x**2 - 4*x + 3; vẫn giữ fallback 2D_GRAPH."""
    vis_custom = ai_recognition_service._build_math_visualization("y = 2x^2 + 3x - 5")
    assert vis_custom is not None
    assert vis_custom["type"] == "2D_GRAPH"
    fn_expr = vis_custom["parameters"]["function"]
    assert fn_expr != "x**2 - 4*x + 3"
    # Đánh giá tại x = 1: 2*(1)^2 + 3*(1) - 5 = 0; tại x = 2: 8 + 6 - 5 = 9
    assert eval(fn_expr, {"__builtins__": {}}, {"x": 1, "math": math}) == 0
    assert eval(fn_expr, {"__builtins__": {}}, {"x": 2, "math": math}) == 9

    # Fallback mặc định vẫn giữ type == 2D_GRAPH cho các biểu thức chung
    vis_fallback = ai_recognition_service._build_math_visualization("E = mc^2")
    assert vis_fallback["type"] == "2D_GRAPH"


def test_m8_h1_m15_h6_degraded_reason_benchmark_cleanup_and_correct_token(monkeypatch):
    """M8, H1, M15, H6: Mathpix lỗi trả success=False; H1 không báo thiếu key oan; M15 dọn sạch rác; H6 lưu lại trang."""
    import asyncio
    import httpx
    from fastapi.testclient import TestClient
    from app.ai.gemini_service import gemini_service
    from app.ai.mathpix_service import mathpix_service
    from app.core.database import in_memory_pages, in_memory_snapshots
    from app.main import app

    client = TestClient(app)

    # M8: Khi Mathpix đã cấu hình nhưng lỗi mạng -> trả success=False (không trả công thức bịa theo hash)
    monkeypatch.setattr(mathpix_service, "app_id", "test-id")
    monkeypatch.setattr(mathpix_service, "app_key", "test-key")

    async def _fail_post(*_args, **_kwargs):
        raise httpx.ConnectError("mathpix down")

    monkeypatch.setattr(httpx.AsyncClient, "post", _fail_post)
    m_res = asyncio.run(mathpix_service.recognize_latex("iVBORw0KGgo=", subject="MATH"))
    assert m_res["success"] is False

    # H1: Khi có degraded_reason (key đã cấu hình nhưng dịch vụ tạm gián đoạn), không báo sai 'chưa cấu hình GEMINI_API_KEY'
    degraded = gemini_service._mock_result("TOAN", degraded_reason="QuotaExceeded")
    assert "chưa cấu hình GEMINI_API_KEY" not in (degraded.explanation or "")

    # M15: Chạy /api/v1/benchmark/run-full-audit không để lại snapshot rác cho lớp thật 10A1/10A2
    before_count = len(in_memory_snapshots)
    audit = client.post("/api/v1/benchmark/run-full-audit?simulated_strokes_count=100&degraded_latency_ms=1800")
    assert audit.status_code == 200
    assert len(in_memory_snapshots) == before_count

    # H6: /api/v1/canvas/correct-token lưu công thức đã sửa vào in_memory_pages khi có room_id + page_number
    client.post(
        "/api/v1/sessions/pages",
        json={"room_id": "room-h6", "session_id": "sess-h6", "page_number": 1, "recognized_latex": "y = \\sim(x)"},
    )
    corr = client.post(
        "/api/v1/canvas/correct-token",
        json={
            "session_id": "sess-h6",
            "room_id": "room-h6",
            "page_number": 1,
            "original_text": "\\sim",
            "corrected_text": "\\sin",
            "context_latex": "y = \\sim(x)",
        },
    )
    assert corr.status_code == 200
    assert corr.json()["persisted"] is True
    assert in_memory_pages["room-h6:sess-h6"][1]["recognized_latex"] == "y = \\sin(x)"
