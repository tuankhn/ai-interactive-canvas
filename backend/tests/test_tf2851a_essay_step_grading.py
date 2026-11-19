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
