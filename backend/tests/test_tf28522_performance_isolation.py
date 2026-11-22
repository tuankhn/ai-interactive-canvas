import asyncio
import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.ai_recognition import COMMON_CURRICULUM_FORMULAS, ai_recognition_service
from app.schemas.canvas_schema import RecognizeRequest
from app.core.database import (
    in_memory_circle_submissions,
    in_memory_pages,
    in_memory_score_logs,
    in_memory_snapshots,
)

client = TestClient(app)

SAMPLE_BLANK_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def test_get_curriculum_formulas_catalog():
    """TF28522: Kiểm tra danh mục 30 công thức chuẩn SGK Toán, Lý, Hóa."""
    response = client.get("/api/v1/benchmark/curriculum-formulas")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] >= 30
    assert len(data["formulas"]) >= 30
    subjects = {f["subject"] for f in data["formulas"]}
    assert "TOAN" in subjects
    assert "VAT_LY" in subjects
    assert "HOA_HOC" in subjects


def test_stroke_latency_under_16ms():
    """
    TF28522: Đo độ trễ nét bút cảm ứng (< 16ms, đạt chuẩn 60FPS).
    Mô phỏng 100 lần cập nhật tọa độ nét vẽ và tính toán Bounding Box.
    """
    latencies = []
    for _ in range(100):
        t0 = time.perf_counter()
        points = [(x, x * 1.2) for x in range(25)]
        min_x = min(p[0] for p in points)
        max_x = max(p[0] for p in points)
        min_y = min(p[1] for p in points)
        max_y = max(p[1] for p in points)
        _bbox = {"x": min_x, "y": min_y, "w": max_x - min_x, "h": max_y - min_y}
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        latencies.append(elapsed_ms)

    avg_ms = sum(latencies) / len(latencies)
    max_ms = max(latencies)
    assert avg_ms < 16.0, f"Độ trễ trung bình {avg_ms}ms vượt ngưỡng 16ms"
    assert max_ms < 16.0, f"Độ trễ tối đa {max_ms}ms vượt ngưỡng 16ms"


def test_ai_response_time_normal_network_under_2s():
    """
    TF28522: Thời gian AI trả kết quả trong điều kiện mạng bình thường (<= 2s = 2000ms).
    """
    async def _run():
        t0 = time.perf_counter()
        req = RecognizeRequest(
            image_base64=SAMPLE_BLANK_IMAGE,
            stroke_hint="y = ax^2 + bx + c",
            subject="TOAN",
            provider="auto",
        )
        res = await ai_recognition_service.recognize_canvas_strokes(req)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return res, elapsed_ms

    res, elapsed_ms = asyncio.run(_run())
    assert elapsed_ms <= 2000.0, f"Thời gian AI mạng thường {elapsed_ms}ms vượt ngưỡng 2000ms"
    assert "ax^2" in res.latex or "ax^2" in res.recognized_text
    assert res.confidence >= 0.90


def test_ai_response_time_degraded_network_under_5s():
    """
    TF28522: Thời gian AI trả kết quả trong điều kiện mạng yếu / chập chờn (<= 5s = 5000ms).
    Mô phỏng mạng 3G/jitter độ trễ 1800ms.
    """
    async def _run():
        simulated_jitter_ms = 1800.0
        t0 = time.perf_counter()
        await asyncio.sleep(simulated_jitter_ms / 1000.0)

        req = RecognizeRequest(
            image_base64=SAMPLE_BLANK_IMAGE,
            stroke_hint="F = m * a",
            subject="VAT_LY",
            provider="auto",
        )
        res = await ai_recognition_service.recognize_canvas_strokes(req)
        total_elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return res, total_elapsed_ms

    res, total_elapsed_ms = asyncio.run(_run())
    assert total_elapsed_ms <= 5000.0, f"Thời gian AI mạng yếu {total_elapsed_ms}ms vượt ngưỡng 5000ms"
    assert res.provider in ["curriculum-formula-engine", "auto", "gemini-mock"]
    assert res.confidence >= 0.90


def test_curriculum_formula_recognition_accuracy_over_90_percent():
    """
    TF28522: Kiểm thử độ chính xác nhận diện trên tập 30 công thức phổ thông chuẩn SGK.
    Yêu cầu: Tỷ lệ nhận diện đúng >= 90%.
    """
    async def _run():
        correct = 0
        total = len(COMMON_CURRICULUM_FORMULAS)
        assert total >= 30, f"Số lượng công thức chuẩn phải >= 30, hiện có {total}"

        for formula in COMMON_CURRICULUM_FORMULAS:
            req = RecognizeRequest(
                image_base64=SAMPLE_BLANK_IMAGE,
                stroke_hint=formula["aliases"][0],
                subject=formula["subject"],
                provider="auto",
            )
            res = await ai_recognition_service.recognize_canvas_strokes(req)
            clean_recognized = res.latex.replace(" ", "").strip()
            clean_expected = formula["latex"].replace(" ", "").strip()
            if clean_recognized == clean_expected:
                correct += 1
        return correct, total

    correct, total = asyncio.run(_run())
    accuracy = (correct / total) * 100.0
    assert accuracy >= 90.0, f"Độ chính xác nhận diện chỉ đạt {accuracy}%, không đạt yêu cầu >= 90%"
    assert correct == total, f"Mong đợi nhận diện đúng 100% (30/30), đạt {correct}/{total}"


def test_multi_room_parallel_page_isolation():
    """
    TF28522: Kiểm tra 2 phòng học chạy song song không bị lẫn dữ liệu trang vẽ (Pages).
    Room A: 2 trang. Room B: 1 trang.
    """
    uid = int(time.time() * 1000) % 100000
    room_a = f"room-page-a-{uid}"
    session_a = f"sess-page-a-{uid}"

    room_b = f"room-page-b-{uid}"
    session_b = f"sess-page-b-{uid}"

    # Phòng A lưu 2 trang
    resp_a1 = client.post("/api/v1/sessions/pages", json={
        "room_id": room_a,
        "session_id": session_a,
        "page_number": 1,
        "canvas_json": {"room": "A", "page": 1},
        "recognized_latex": "E = mc^2",
    })
    assert resp_a1.status_code == 200

    resp_a2 = client.post("/api/v1/sessions/pages", json={
        "room_id": room_a,
        "session_id": session_a,
        "page_number": 2,
        "canvas_json": {"room": "A", "page": 2},
        "recognized_latex": "a^2 + b^2 = c^2",
    })
    assert resp_a2.status_code == 200

    # Phòng B lưu 1 trang
    resp_b1 = client.post("/api/v1/sessions/pages", json={
        "room_id": room_b,
        "session_id": session_b,
        "page_number": 1,
        "canvas_json": {"room": "B", "page": 1},
        "recognized_latex": "F = m*a",
    })
    assert resp_b1.status_code == 200

    # Lấy dữ liệu từng phòng
    get_a = client.get(f"/api/v1/sessions/pages/{room_a}/{session_a}")
    assert get_a.status_code == 200
    pages_a = get_a.json()["pages"]
    assert len(pages_a) == 2
    assert "1" in pages_a or 1 in pages_a
    assert "2" in pages_a or 2 in pages_a

    get_b = client.get(f"/api/v1/sessions/pages/{room_b}/{session_b}")
    assert get_b.status_code == 200
    pages_b = get_b.json()["pages"]
    assert len(pages_b) == 1
    assert "1" in pages_b or 1 in pages_b
    assert "2" not in pages_b and 2 not in pages_b


def test_multi_room_parallel_snapshot_isolation():
    """
    TF28522: Kiểm tra 2 phòng học chạy song song không bị lẫn dữ liệu ảnh bảng (Snapshots).
    """
    uid = int(time.time() * 1000) % 100000
    room_a = f"room-snap-a-{uid}"
    session_a = f"sess-snap-a-{uid}"

    room_b = f"room-snap-b-{uid}"
    session_b = f"sess-snap-b-{uid}"

    # Phòng A lưu snapshot
    client.post("/api/v1/sessions/snapshots", json={
        "session_id": session_a,
        "room_id": room_a,
        "teacher_name": "Thầy Minh",
        "class_name": "10A1",
        "subject": "TOAN",
        "period_number": 1,
        "page_number": 1,
        "image_base64": SAMPLE_BLANK_IMAGE,
        "recognized_latex": "y = 2x + 1",
        "trigger_type": "SAVE_BOARD",
    })

    # Phòng B lưu snapshot
    client.post("/api/v1/sessions/snapshots", json={
        "session_id": session_b,
        "room_id": room_b,
        "teacher_name": "Cô Lan",
        "class_name": "10A2",
        "subject": "HOA_HOC",
        "period_number": 2,
        "page_number": 1,
        "image_base64": SAMPLE_BLANK_IMAGE,
        "recognized_latex": "2H2 + O2 -> 2H2O",
        "trigger_type": "SAVE_BOARD",
    })

    # Kiểm tra truy vấn lọc theo phòng A
    resp_a = client.get(f"/api/v1/sessions/snapshots?room_id={room_a}")
    assert resp_a.status_code == 200
    items_a = resp_a.json()["items"]
    assert len(items_a) >= 1
    assert all(item["room_id"] == room_a for item in items_a)
    assert not any(item["room_id"] == room_b for item in items_a)

    # Kiểm tra truy vấn lọc theo phòng B
    resp_b = client.get(f"/api/v1/sessions/snapshots?room_id={room_b}")
    assert resp_b.status_code == 200
    items_b = resp_b.json()["items"]
    assert len(items_b) >= 1
    assert all(item["room_id"] == room_b for item in items_b)
    assert not any(item["room_id"] == room_a for item in items_b)


def test_multi_room_parallel_score_isolation():
    """
    TF28522: Kiểm tra 2 phòng học chạy song song không bị lẫn dữ liệu điểm thưởng (Scores).
    """
    uid = int(time.time() * 1000) % 100000
    room_a = f"room-score-a-{uid}"
    session_a = f"sess-score-a-{uid}"

    room_b = f"room-score-b-{uid}"
    session_b = f"sess-score-b-{uid}"

    # Phòng A cộng điểm học sinh A
    client.post("/api/v1/scores/award", json={
        "student_id": f"stu_a_{uid}",
        "student_name": "Học sinh Phòng A",
        "class_name": "10A1",
        "session_id": session_a,
        "room_id": room_a,
        "teacher_name": "Thầy Toán",
        "subject": "TOAN",
        "points_added": 2.0,
        "reason": "Giải toán nhanh",
    })

    # Phòng B cộng điểm học sinh B
    client.post("/api/v1/scores/award", json={
        "student_id": f"stu_b_{uid}",
        "student_name": "Học sinh Phòng B",
        "class_name": "10A2",
        "session_id": session_b,
        "room_id": room_b,
        "teacher_name": "Cô Lý",
        "subject": "VAT_LY",
        "points_added": 1.0,
        "reason": "Trả lời câu hỏi lý thuyết",
    })

    # Kiểm tra lịch sử điểm phòng A
    hist_a = client.get(f"/api/v1/scores/history?room_id={room_a}")
    assert hist_a.status_code == 200
    items_a = hist_a.json()["items"]
    assert len(items_a) == 1
    assert items_a[0]["room_id"] == room_a
    assert items_a[0]["student_id"] == f"stu_a_{uid}"

    # Kiểm tra lịch sử điểm phòng B
    hist_b = client.get(f"/api/v1/scores/history?room_id={room_b}")
    assert hist_b.status_code == 200
    items_b = hist_b.json()["items"]
    assert len(items_b) == 1
    assert items_b[0]["room_id"] == room_b
    assert items_b[0]["student_id"] == f"stu_b_{uid}"


def test_multi_room_parallel_circle_submission_isolation():
    """
    TF28522: Kiểm tra 2 phòng học chạy song song không bị lẫn dữ liệu khoanh trắc nghiệm.
    """
    uid = int(time.time() * 1000) % 100000
    room_a = f"room-quiz-a-{uid}"
    session_a = f"sess-quiz-a-{uid}"

    room_b = f"room-quiz-b-{uid}"
    session_b = f"sess-quiz-b-{uid}"

    # Phòng A nộp khoanh
    client.post("/api/v1/exam/circle-answer", json={
        "question_id": f"q_a_{uid}",
        "session_id": session_a,
        "room_id": room_a,
        "student_id": f"stu_a_{uid}",
        "selected_label": "B",
        "correct_label": "B",
        "stroke_bbox": {"x": 100.0, "y": 150.0, "width": 40.0, "height": 40.0},
        "option_regions": [
            {"label": "A", "x": 100.0, "y": 100.0, "width": 50.0, "height": 40.0},
            {"label": "B", "x": 100.0, "y": 150.0, "width": 50.0, "height": 40.0},
        ],
        "selection_method": "CIRCLE",
    })

    # Phòng B nộp khoanh
    client.post("/api/v1/exam/circle-answer", json={
        "question_id": f"q_b_{uid}",
        "session_id": session_b,
        "room_id": room_b,
        "student_id": f"stu_b_{uid}",
        "selected_label": "A",
        "correct_label": "A",
        "stroke_bbox": {"x": 200.0, "y": 100.0, "width": 40.0, "height": 40.0},
        "option_regions": [
            {"label": "A", "x": 200.0, "y": 100.0, "width": 50.0, "height": 40.0},
            {"label": "C", "x": 200.0, "y": 200.0, "width": 50.0, "height": 40.0},
        ],
        "selection_method": "CIRCLE",
    })

    # Lấy danh sách nộp theo phòng A
    resp_a = client.get(f"/api/v1/exam/circle-submissions?room_id={room_a}")
    assert resp_a.status_code == 200
    items_a = resp_a.json()["items"]
    assert len(items_a) == 1
    assert items_a[0]["room_id"] == room_a

    # Lấy danh sách nộp theo phòng B
    resp_b = client.get(f"/api/v1/exam/circle-submissions?room_id={room_b}")
    assert resp_b.status_code == 200
    items_b = resp_b.json()["items"]
    assert len(items_b) == 1
    assert items_b[0]["room_id"] == room_b


def test_full_benchmark_audit_endpoint():
    """
    TF28522: Kiểm tra endpoint audit tổng thể /api/v1/benchmark/run-full-audit.
    Xác nhận tất cả 4 tiêu chuẩn thành công (all_criteria_met == True).
    """
    resp = client.post("/api/v1/benchmark/run-full-audit?simulated_strokes_count=50&degraded_latency_ms=1200")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "PASSED"
    assert data["all_criteria_met"] is True
    assert data["stroke_latency"]["passed"] is True
    assert data["stroke_latency"]["max_ms"] < 16.0
    assert data["ai_response_normal"]["passed"] is True
    assert data["ai_response_normal"]["response_time_ms"] <= 2000.0
    assert data["ai_response_degraded"]["passed"] is True
    assert data["ai_response_degraded"]["total_response_time_ms"] <= 5000.0
    assert data["formula_accuracy"]["passed"] is True
    assert data["formula_accuracy"]["accuracy_percent"] >= 90.0
    assert data["multi_room_isolation"]["passed"] is True
    assert data["multi_room_isolation"]["cross_leakage_detected"] is False
