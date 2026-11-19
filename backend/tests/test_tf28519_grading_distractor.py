import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.grading_service import grading_service

client = TestClient(app)


def test_evaluate_mcq_choice_correct_answer():
    """Kiểm tra học sinh chọn đúng: Tích xanh (#16a34a), icon '✓', giải thích đúng và cộng 1.0 điểm."""
    res = grading_service.evaluate_mcq_choice(
        question_id="q1",
        selected_label="A",
        correct_label="A",
        correct_explanation="Theo công thức đạo hàm (x^2)' = 2x.",
        question_content="Đạo hàm của x^2 là gì?",
        subject="TOAN",
    )
    assert res.is_correct is True
    assert res.status == "CORRECT"
    assert res.badge_color == "#16a34a"
    assert res.icon == "✓"
    assert res.selected_label == "A"
    assert res.correct_label == "A"
    assert res.distractor_analysis is None
    assert "2x" in res.explanation
    assert res.suggested_bonus_points == 1.0
    assert "Xuất sắc" in res.guidance


def test_evaluate_mcq_choice_incorrect_answer_with_distractor_analysis():
    """Kiểm tra học sinh chọn sai: Cảnh báo đỏ (#dc2626), icon '✕', chỉ rõ lý do sai và hướng dẫn tìm đáp án đúng."""
    res = grading_service.evaluate_mcq_choice(
        question_id="q2",
        selected_label="B",
        correct_label="A",
        correct_explanation="Vận tốc v = s / t.",
        subject="VAT_LY",
    )
    assert res.is_correct is False
    assert res.status == "INCORRECT"
    assert res.badge_color == "#dc2626"
    assert res.icon == "✕"
    assert res.selected_label == "B"
    assert res.correct_label == "A"
    assert res.distractor_analysis is not None
    assert "Lý do sai của phương án B" in res.distractor_analysis
    assert res.guidance is not None
    assert "Gợi ý" in res.guidance
    assert res.suggested_bonus_points == 0.0


def test_distractor_math_derivative_context():
    """Kiểm tra phân tích phương án gây nhiễu trong ngữ cảnh toán đạo hàm."""
    res = grading_service.evaluate_mcq_choice(
        question_id="q_math",
        selected_label="B",
        correct_label="A",
        question_content="Tính đạo hàm của hàm số y = 3x^2.",
        subject="TOAN",
    )
    assert res.is_correct is False
    assert "nguyên hàm" in res.distractor_analysis.lower() or "đạo hàm" in res.distractor_analysis.lower()
    assert res.error_category in ["FORMULA_CONFUSION", "CONCEPTUAL_ERROR"]


def test_distractor_physics_unit_conversion():
    """Kiểm tra môn Vật lý: Phát hiện lỗi phương án gây nhiễu do quên đổi đơn vị đo lường."""
    res = grading_service.evaluate_mcq_choice(
        question_id="q_phys",
        selected_label="A",
        correct_label="B",
        question_content="Một xe chuyển động với vận tốc 72 km/h. Tính quãng đường xe đi được trong 10 giây.",
        subject="VAT_LY",
    )
    assert res.is_correct is False
    assert "đổi đơn vị" in res.distractor_analysis.lower()
    assert res.error_category == "UNIT_CONVERSION_ERROR"


def test_distractor_chemistry_redox():
    """Kiểm tra môn Hóa học: Phân tích phương án gây nhiễu về chất khử / chất oxi hóa."""
    res = grading_service.evaluate_mcq_choice(
        question_id="q_chem",
        selected_label="A",
        correct_label="C",
        question_content="Trong phản ứng 2Fe + 3Cl2 -> 2FeCl3, chất khử là gì?",
        subject="HOA_HOC",
    )
    assert res.is_correct is False
    assert "chất khử" in res.distractor_analysis.lower()
    assert res.error_category == "CONCEPTUAL_ERROR"


def test_distractor_english_grammar():
    """Kiểm tra môn Tiếng Anh: Phân tích phương án gây nhiễu về thì của động từ."""
    res = grading_service.evaluate_mcq_choice(
        question_id="q_eng",
        selected_label="A",
        correct_label="C",
        question_content="She _____ to London last summer.",
        subject="TIENG_ANH",
    )
    assert res.is_correct is False
    assert "thì" in res.distractor_analysis.lower()
    assert res.error_category == "GRAMMAR_ERROR"


def test_custom_teacher_distractor_map():
    """Kiểm tra ưu tiên phân tích phương án gây nhiễu do giáo viên tùy chỉnh."""
    teacher_map = {
        "C": "Học sinh quên điều kiện mẫu thức x - 2 khác 0 dẫn đến lấy nghiệm x = 2.",
    }
    res = grading_service.evaluate_mcq_choice(
        question_id="q_custom",
        selected_label="C",
        correct_label="A",
        distractor_map=teacher_map,
        subject="TOAN",
    )
    assert res.is_correct is False
    assert "quên điều kiện mẫu thức x - 2 khác 0" in res.distractor_analysis
    assert res.error_category == "CUSTOM_TEACHER_EXPLANATION"


def test_api_grade_mcq_endpoint_correct():
    """Kiểm tra API POST /api/v1/exam/grade-mcq trả về tích xanh khi học sinh khoanh đúng."""
    payload = {
        "question_id": "q101",
        "selected_label": "B",
        "correct_label": "B",
        "explanation": "Số nguyên tố chẵn duy nhất là số 2.",
        "subject": "TOAN",
    }
    response = client.post("/api/v1/exam/grade-mcq", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_correct"] is True
    assert data["status"] == "CORRECT"
    assert data["badge_color"] == "#16a34a"
    assert data["icon"] == "✓"
    assert data["suggested_bonus_points"] == 1.0


def test_api_grade_mcq_endpoint_incorrect():
    """Kiểm tra API POST /api/v1/exam/grade-mcq trả về cảnh báo đỏ và phân tích khi chọn sai."""
    payload = {
        "question_id": "q102",
        "selected_label": "C",
        "correct_label": "A",
        "explanation": "Đáp án A là căn bậc hai số học dương.",
        "question_content": "Căn bậc hai số học của 9 là mấy?",
        "subject": "TOAN",
    }
    response = client.post("/api/v1/exam/grade-mcq", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_correct"] is False
    assert data["status"] == "INCORRECT"
    assert data["badge_color"] == "#dc2626"
    assert data["icon"] == "✕"
    assert "Lý do sai của phương án C" in data["distractor_analysis"]
    assert "Gợi ý" in data["guidance"]


def test_api_quiz_alias_endpoint():
    """Kiểm tra gọi qua route alias POST /api/v1/quiz/grade-mcq."""
    payload = {
        "question_id": "q_alias",
        "selected_label": "A",
        "correct_label": "A",
        "explanation": "Chuẩn xác.",
    }
    response = client.post("/api/v1/quiz/grade-mcq", json=payload)
    assert response.status_code == 200
    assert response.json()["is_correct"] is True


def test_api_grade_mcq_empty_selection_400():
    """Kiểm tra validation khi học sinh chưa chọn phương án nào."""
    payload = {
        "question_id": "q_empty",
        "selected_label": "",
        "correct_label": "A",
    }
    response = client.post("/api/v1/exam/grade-mcq", json=payload)
    assert response.status_code == 400
    assert "Vui lòng chọn" in response.json()["detail"]


def test_api_distractor_analysis_endpoint():
    """Kiểm tra API POST /api/v1/exam/distractor-analysis phân tích đồng thời 4 phương án."""
    response = client.post(
        "/api/v1/exam/distractor-analysis?correct_label=A&subject=TOAN&question_content=Tìm đạo hàm"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["correct_label"] == "A"
    distractors = data["distractors"]
    assert distractors["A"]["is_correct"] is True
    assert distractors["B"]["is_correct"] is False
    assert distractors["C"]["is_correct"] is False
    assert distractors["D"]["is_correct"] is False
    assert "reason" in distractors["B"]
    assert "guidance" in distractors["B"]


def test_frontend_mcq_grading_ui_served():
    """Kiểm tra giao diện index.html có chứa nút chấm trắc nghiệm và dialog phản hồi phương án gây nhiễu."""
    response = client.get("/")
    assert response.status_code == 200
    html = response.text
    assert "gradeMcqBtn" in html
    assert "gradeFeedbackDialog" in html
    assert "feedbackResultBadge" in html
    assert "feedbackDistractorBox" in html
    assert "feedbackGuidanceBox" in html
    assert "feedbackExplanationBox" in html
