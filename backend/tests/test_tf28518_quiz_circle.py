from fastapi.testclient import TestClient

from app.core.database import in_memory_circle_submissions
from app.main import app

client = TestClient(app)

SAMPLE_OPTION_REGIONS = [
    {"label": "A", "x": 48.0, "y": 102.0, "width": 780.0, "height": 46.0},
    {"label": "B", "x": 48.0, "y": 160.0, "width": 780.0, "height": 46.0},
    {"label": "C", "x": 48.0, "y": 218.0, "width": 780.0, "height": 46.0},
    {"label": "D", "x": 48.0, "y": 276.0, "width": 780.0, "height": 46.0},
]


def test_circle_answer_matches_option_region_and_grades_correct():
    in_memory_circle_submissions.clear()

    # Học sinh cầm bút khoanh quanh vòng tròn chữ B (x=52..94, y=162..202)
    res = client.post(
        "/api/v1/exam/circle-answer",
        json={
            "question_id": "q-toan-1",
            "session_id": "sess-quiz-1",
            "room_id": "room-10a1",
            "stroke_bbox": {"x": 52.0, "y": 162.0, "width": 42.0, "height": 40.0},
            "option_regions": SAMPLE_OPTION_REGIONS,
            "stroke_points_count": 28,
            "circularity_score": 0.91,
            "selection_method": "CIRCLE_GESTURE",
            "question_content": "Đạo hàm của y = x^2 là gì?",
            "correct_label": "B",
            "explanation": "(x^2)' = 2x.",
            "subject": "TOAN",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["matched_label"] == "B"
    assert data["overlap_score"] > 0.7
    assert data["selection_method"] == "CIRCLE_GESTURE"
    assert data["grade_result"]["is_correct"] is True
    assert data["grade_result"]["badge_color"] == "#16a34a"


def test_circle_answer_incorrect_returns_distractor_and_logs_submission():
    in_memory_circle_submissions.clear()

    # Khoanh vào vùng phương án C mà không gửi selected_label -> Backend tự khớp hình học
    res = client.post(
        "/api/v1/exam/circle-answer",
        json={
            "question_id": "q-ly-2",
            "session_id": "sess-quiz-2",
            "stroke_bbox": {"x": 50.0, "y": 219.0, "width": 48.0, "height": 44.0},
            "option_regions": SAMPLE_OPTION_REGIONS,
            "stroke_points_count": 32,
            "circularity_score": 0.87,
            "correct_label": "A",
            "question_content": "Một xe chạy với vận tốc 72 km/h trong 10 giây đi được bao nhiêu mét?",
            "subject": "VAT_LY",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["matched_label"] == "C"
    assert data["grade_result"]["is_correct"] is False
    assert data["grade_result"]["badge_color"] == "#dc2626"
    assert data["grade_result"]["distractor_analysis"] is not None

    # Kiểm tra lịch sử các lượt khoanh đáp án đã lưu ở Backend
    logs_res = client.get("/api/v1/exam/circle-submissions", params={"session_id": "sess-quiz-2"})
    assert logs_res.status_code == 200
    logs = logs_res.json()
    assert logs["count"] == 1
    assert logs["items"][0]["matched_label"] == "C"
    assert logs["items"][0]["stroke_bbox"]["y"] == 219.0


def test_circle_answer_alias_and_non_overlapping_rejection():
    in_memory_circle_submissions.clear()

    alias_res = client.post(
        "/api/v1/quiz/circle-answer",
        json={
            "question_id": "q-eng-3",
            "stroke_bbox": {"x": 54.0, "y": 103.0, "width": 40.0, "height": 40.0},
            "option_regions": SAMPLE_OPTION_REGIONS,
            "correct_label": "A",
            "subject": "TIENG_ANH",
        },
    )
    assert alias_res.status_code == 200
    assert alias_res.json()["matched_label"] == "A"

    # Vùng khoanh nằm hoàn toàn ngoài 4 phương án và không có fallback -> trả 400
    miss_res = client.post(
        "/api/v1/exam/circle-answer",
        json={
            "question_id": "q-miss",
            "stroke_bbox": {"x": 650.0, "y": 550.0, "width": 50.0, "height": 50.0},
            "option_regions": SAMPLE_OPTION_REGIONS,
            "correct_label": "A",
        },
    )
    assert miss_res.status_code == 400


def test_quiz_board_assets_served_with_circle_controls():
    html_res = client.get("/")
    assert html_res.status_code == 200
    assert 'id="quizBoardToggleBtn"' in html_res.text
    assert 'id="quizBoardPanel"' in html_res.text

    js_res = client.get("/src/components/quiz_board.js")
    assert js_res.status_code == 200
    assert "detectCircleSelectionGesture" in js_res.text
    assert "/api/v1/exam/circle-answer" in js_res.text
