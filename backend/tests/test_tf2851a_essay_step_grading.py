import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.grading_service import grading_service

client = TestClient(app)


def test_evaluate_essay_step_correct_green_check():
    """Kiểm tra bước biến đổi đúng: Đánh dấu tích xanh, màu #16a34a, không có lỗi toán học."""
    res = grading_service.evaluate_essay_step(
        question_id="essay_1",
        step_number=1,
        written_text="2x + 4 = 10",
        previous_steps=[],
        question_content="Giải phương trình 2x + 4 = 10",
        subject="TOAN",
        target_answer="x = 3",
    )
    assert res.is_step_correct is True
    assert res.status == "CORRECT"
    assert res.decoration_type == "GREEN_CHECK"
    assert res.badge_color == "#16a34a"
    assert res.icon == "✓"
    assert res.has_math_error is False
    assert res.no_leak_guarantee is True
    assert res.canvas_annotation["type"] == "green_check"


def test_evaluate_essay_step_formula_error_red_underline():
    """Kiểm tra nhầm hằng đẳng thức: Đánh dấu gạch chân đỏ, chỉ rõ quên 2ab và hiện gợi ý sửa không lộ đáp án."""
    res = grading_service.evaluate_essay_step(
        question_id="essay_2",
        step_number=2,
        written_text="(x + 2)^2 = x^2 + 4",
        previous_steps=["Khai triển biểu thức (x + 2)^2"],
        subject="TOAN",
        target_answer="x^2 + 4x + 4",
    )
    assert res.is_step_correct is False
    assert res.status == "INCORRECT"
    assert res.decoration_type == "RED_UNDERLINE"
    assert res.badge_color == "#dc2626"
    assert res.icon == "✕"
    assert res.has_math_error is True
    assert res.error_type == "FORMULA_ERROR"
    assert "hằng đẳng thức" in res.feedback.lower()
    assert res.guidance is not None
    assert "2AB" in res.guidance or "2ab" in res.guidance.lower()
    assert res.no_leak_guarantee is True
    assert res.canvas_annotation["type"] == "red_underline"


def test_evaluate_essay_step_sign_error_red_underline():
    """Kiểm tra lỗi chuyển vế không đổi dấu: Đánh dấu gạch chân đỏ và nhắc quy tắc chuyển vế."""
    res = grading_service.evaluate_essay_step(
        question_id="essay_3",
        step_number=2,
        written_text="2x = -6",
        previous_steps=["2x - 6 = 0"],
        subject="TOAN",
        target_answer="x = 3",
    )
    assert res.is_step_correct is False
    assert res.decoration_type == "RED_UNDERLINE"
    assert res.error_type == "SIGN_ERROR"
    assert "chuyển vế" in res.feedback.lower()
    assert "đổi dấu" in res.guidance.lower()
    # Không lộ đáp án cuối x = 3
    assert "x = 3" not in res.guidance


def test_evaluate_essay_step_derivative_formula_error():
    """Kiểm tra nhầm công thức đạo hàm (sin x)' = -cos x."""
    res = grading_service.evaluate_essay_step(
        question_id="essay_4",
        step_number=1,
        written_text="y' = (sin x)' = -cos x",
        subject="TOAN",
        target_answer="cos x",
    )
    assert res.is_step_correct is False
    assert res.decoration_type == "RED_UNDERLINE"
    assert res.error_type == "FORMULA_ERROR"
    assert "đạo hàm" in res.feedback.lower()


def test_evaluate_essay_step_arithmetic_calculation_error():
    """Kiểm tra dòng tính nhẩm sai số học."""
    res = grading_service.evaluate_essay_step(
        question_id="essay_5",
        step_number=3,
        written_text="Ta có 4 * 5 = 25",
        subject="TOAN",
    )
    assert res.is_step_correct is False
    assert res.decoration_type == "RED_UNDERLINE"
    assert res.error_type == "CALCULATION_ERROR"
    assert "tính toán" in res.feedback.lower()


def test_no_leak_guarantee():
    """Đảm bảo 100% không rò rỉ đáp án cuối cùng trong nội dung gợi ý."""
    target_answer = "x = 42"
    res = grading_service.evaluate_essay_step(
        question_id="essay_leak_check",
        step_number=2,
        written_text="Ta tính nhầm 2 + 3 = 6",
        target_answer=target_answer,
    )
    assert res.is_step_correct is False
    assert target_answer not in (res.guidance or "")
    assert res.no_leak_guarantee is True


def test_evaluate_essay_solution_full_multi_step():
    """Kiểm tra chấm toàn bộ bài giải tự luận gồm nhiều bước kết hợp đúng và sai."""
    steps = [
        "2x + 4 = 10",           # Bước 1: đúng
        "(x + 1)^2 = x^2 + 1",   # Bước 2: sai hằng đẳng thức (thiếu 2x)
        "2x = 6",                # Bước 3: đúng
    ]
    sol_res = grading_service.evaluate_essay_solution(
        question_id="full_sol_1",
        steps=steps,
        subject="TOAN",
        target_answer="x = 3",
    )
    assert sol_res.total_steps == 3
    assert sol_res.correct_steps == 2
    assert sol_res.incorrect_steps == 1
    assert sol_res.has_any_error is True
    assert sol_res.first_error_step == 2
    assert sol_res.steps_evaluation[0].decoration_type == "GREEN_CHECK"
    assert sol_res.steps_evaluation[1].decoration_type == "RED_UNDERLINE"
    assert sol_res.steps_evaluation[2].decoration_type == "GREEN_CHECK"


def test_api_grade_essay_step_endpoint_correct():
    """Kiểm tra endpoint API POST /api/v1/exam/grade-essay-step với dòng đúng."""
    payload = {
        "question_id": "q_step_1",
        "step_number": 1,
        "written_text": "3x - 9 = 0",
        "previous_steps": [],
        "subject": "TOAN",
        "target_answer": "x = 3",
    }
    response = client.post("/api/v1/exam/grade-essay-step", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_step_correct"] is True
    assert data["decoration_type"] == "GREEN_CHECK"
    assert data["badge_color"] == "#16a34a"
    assert data["icon"] == "✓"


def test_api_grade_essay_step_endpoint_incorrect():
    """Kiểm tra endpoint API POST /api/v1/exam/grade-essay-step với dòng sai."""
    payload = {
        "question_id": "q_step_2",
        "step_number": 2,
        "written_text": "(a + b)^2 = a^2 + b^2",
        "previous_steps": ["Khai triển"],
        "subject": "TOAN",
        "target_answer": "a^2 + 2ab + b^2",
    }
    response = client.post("/api/v1/exam/grade-essay-step", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_step_correct"] is False
    assert data["decoration_type"] == "RED_UNDERLINE"
    assert data["badge_color"] == "#dc2626"
    assert data["icon"] == "✕"
    assert "gợi ý" in data["guidance"].lower()
    assert data["no_leak_guarantee"] is True


def test_api_grade_essay_step_empty_validation():
    """Kiểm tra bắt lỗi validation khi gửi bước trống."""
    payload = {
        "question_id": "q_empty",
        "step_number": 1,
        "written_text": "",
    }
    response = client.post("/api/v1/exam/grade-essay-step", json=payload)
    assert response.status_code == 400
    assert "không được để trống" in response.json()["detail"]


def test_api_grade_essay_solution_endpoint():
    """Kiểm tra endpoint API POST /api/v1/exam/grade-essay-solution."""
    payload = {
        "question_id": "q_sol_full",
        "steps": [
            "x^2 - 4 = 0",
            "x^2 = 4",
        ],
        "subject": "TOAN",
        "target_answer": "x = ±2",
    }
    response = client.post("/api/v1/exam/grade-essay-solution", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total_steps"] == 2
    assert data["correct_steps"] == 2
    assert data["has_any_error"] is False


def test_api_quiz_alias_essay_endpoints():
    """Kiểm tra gọi qua route alias POST /api/v1/quiz/grade-essay-step."""
    payload = {
        "question_id": "alias_step",
        "step_number": 1,
        "written_text": "Ta có 2x = 8",
        "target_answer": "x = 4",
    }
    response = client.post("/api/v1/quiz/grade-essay-step", json=payload)
    assert response.status_code == 200
    assert response.json()["is_step_correct"] is True


def test_frontend_essay_grading_ui_served():
    """Kiểm tra giao diện index.html có chứa nút chấm tự luận, dialog và các thành phần đánh dấu."""
    response = client.get("/")
    assert response.status_code == 200
    html = response.text
    assert "gradeEssayBtn" in html
    assert "essayGradingDialog" in html
    assert "evaluateEssayStepsBtn" in html
    assert "annotateEssayToCanvasBtn" in html
    assert "essayStepsList" in html


def test_chaining_quadratic_expansion_correct_and_incorrect():
    """Kiểm tra chaining: Dòng 1 là (x+3)^2, dòng 2 là = x^2+6x+9 (Đúng) hoặc = x^2+9 (Sai)."""
    # Đúng
    res_correct = grading_service.evaluate_essay_solution(
        question_id="quad_chain_1",
        steps=["(x + 3)^2", "= x^2 + 6x + 9"],
        subject="TOAN",
    )
    assert res_correct.has_any_error is False
    assert res_correct.correct_steps == 1  # Đã tự động bóc tách dòng 1 thành đề và dòng 2 là bước giải

    # Sai hằng đẳng thức (thiếu 2ab = 6x)
    res_wrong = grading_service.evaluate_essay_solution(
        question_id="quad_chain_2",
        steps=["(x + 3)^2", "= x^2 + 9"],
        subject="TOAN",
    )
    assert res_wrong.has_any_error is True
    assert res_wrong.first_error_step == 1
    assert "hằng đẳng thức" in res_wrong.steps_evaluation[0].feedback.lower()


def test_english_dash_solution_grading():
    """Kiểm tra Tiếng Anh với dấu gạch đầu dòng '-': Chia đúng went vs chia sai goed."""
    res_en_ok = grading_service.evaluate_essay_solution(
        question_id="en_1",
        steps=["She (go) to school yesterday.", "- went"],
        subject="TIENG_ANH",
    )
    assert res_en_ok.has_any_error is False

    res_en_err = grading_service.evaluate_essay_solution(
        question_id="en_2",
        steps=["She (go) to school yesterday.", "- goed"],
        subject="TIENG_ANH",
    )
    assert res_en_err.has_any_error is True
    assert res_en_err.steps_evaluation[0].error_type == "GRAMMAR_ERROR"


def test_biology_dash_solution_grading():
    """Kiểm tra Sinh học với dấu '-': Tỉ lệ F1 phép lai Aa x Aa."""
    res_bio_err = grading_service.evaluate_essay_solution(
        question_id="bio_1",
        steps=["P: Aa x Aa", "- F1: 1 AA : 1 aa"],
        subject="SINH_HOC",
    )
    assert res_bio_err.has_any_error is True
    assert res_bio_err.steps_evaluation[0].error_type == "CONCEPTUAL_ERROR"


def test_arbitrary_wrong_binomial_expansion_and_latex_marked_incorrect():
    """Regression: Đề bài (x + 3)^2, bước giải = x^3 + 20x + 10 (kể cả dạng LaTeX) bắt buộc phải chấm SAI."""
    res_plain = grading_service.evaluate_essay_solution(
        question_id="reg_user_case_1",
        question_content="(x + 3)^2",
        steps=["= x^3 + 20x + 10"],
        subject="TOAN",
        target_answer="x^2 + 6x + 9",
    )
    assert res_plain.has_any_error is True
    assert res_plain.correct_steps == 0
    assert res_plain.incorrect_steps == 1
    assert res_plain.score == 0.0
    step_eval = res_plain.steps_evaluation[0]
    assert step_eval.is_step_correct is False
    assert step_eval.decoration_type == "RED_UNDERLINE"
    assert step_eval.icon == "✕"
    assert step_eval.no_leak_guarantee is True
    assert "x^2 + 6x + 9" not in (step_eval.guidance or "")

    # Dạng LaTeX từ KaTeX / AI Recognition
    res_latex = grading_service.evaluate_essay_solution(
        question_id="reg_user_case_latex",
        question_content=r"\left(x + 3\right)^{2}",
        steps=[r"= x^{3} + 20x + 10"],
        subject="TOAN",
    )
    assert res_latex.has_any_error is True
    assert res_latex.steps_evaluation[0].is_step_correct is False

    # Sai hệ số tự do hoặc sai dấu hạng tử giữa
    for wrong_step in ["= x^2 + 6x + 6", "= x^2 - 6x + 9", "= 2x + 6"]:
        r = grading_service.evaluate_essay_solution(
            question_id="reg_coef",
            question_content="(x + 3)^2",
            steps=[wrong_step],
            subject="TOAN",
        )
        assert r.has_any_error is True, f"Bỏ sót bước khai triển sai: {wrong_step}"

    # Multi-step khai triển đúng hoàn toàn phải được chấm 10 điểm
    res_valid_chain = grading_service.evaluate_essay_solution(
        question_id="reg_valid_chain",
        question_content="(x + 3)^2",
        steps=[r"= x^{2} + 2 \cdot x \cdot 3 + 3^{2}", "= x^2 + 6x + 9"],
        subject="TOAN",
    )
    assert res_valid_chain.has_any_error is False
    assert res_valid_chain.correct_steps == 2
    assert res_valid_chain.score == 10.0


def test_equation_root_equivalence_and_stray_dot_rejected():
    """Kiểm tra phương trình sai nghiệm & chấm nhiễu '.' không bao giờ được chấm tích xanh."""
    # Phương trình biến đổi sai nghiệm (2x + 4 = 10 -> 2x = 8 -> x = 4)
    res_eq_wrong = grading_service.evaluate_essay_solution(
        question_id="eq_wrong_roots",
        question_content="2x + 4 = 10",
        steps=["2x = 8", "x = 4"],
        subject="TOAN",
    )
    assert res_eq_wrong.has_any_error is True
    assert res_eq_wrong.incorrect_steps == 2
    assert all(not ev.is_step_correct for ev in res_eq_wrong.steps_evaluation)

    # Phương trình bậc hai biến đổi đúng vs sai dấu nghiệm
    res_quad_ok = grading_service.evaluate_essay_solution(
        question_id="quad_eq_ok",
        question_content="x^2 - 5x + 6 = 0",
        steps=["(x - 2)(x - 3) = 0", "x = 2", "x = 3"],
        subject="TOAN",
    )
    assert res_quad_ok.has_any_error is False
    assert res_quad_ok.correct_steps == 3

    res_quad_bad = grading_service.evaluate_essay_solution(
        question_id="quad_eq_bad",
        question_content="x^2 - 5x + 6 = 0",
        steps=["(x + 2)(x + 3) = 0", "x = -2"],
        subject="TOAN",
    )
    assert res_quad_bad.has_any_error is True
    assert res_quad_bad.incorrect_steps == 2

    # Ký tự nhiễu dấu chấm '.' hoặc '\cdot' không được chấm tích xanh
    for noise_tok in [".", r"\cdot", "-", "="]:
        noise_eval = grading_service.evaluate_essay_step(
            question_id="noise_q",
            step_number=1,
            written_text=noise_tok,
            question_content="(x + 3)^2",
        )
        assert noise_eval.is_step_correct is False
        assert noise_eval.error_type == "INCOMPLETE_STEP"

    # Kiểm chứng qua HTTP API endpoint
    resp = client.post(
        "/api/v1/exam/grade-essay-solution",
        json={
            "question_id": "api_reg_user_case",
            "question_content": "(x + 3)^2",
            "subject": "TOAN",
            "steps": ["= x^3 + 20x + 10"],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_any_error"] is True
    assert body["score"] == 0.0
    assert body["steps_evaluation"][0]["is_step_correct"] is False
    assert body["steps_evaluation"][0]["decoration_type"] == "RED_UNDERLINE"


