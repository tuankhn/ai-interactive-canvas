# ==============================================================================
# KIỂM THỬ TÍNH NĂNG AI TẠO CÂU HỎI TƯƠNG TỰ VÀ CÂU HỎI NÂNG CAO (TASK TF2851B)
# Phụ trách: Nguyễn Ngọc Gia Bảo 2 (N25DTCN121) - Sprint 3 (16/11 - 20/11/2026)
# ==============================================================================

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.quiz import (
    GenerateQuestionVariantRequest,
    GenerateQuestionVariantResponse,
)
from app.services.question_generator_service import (
    QuestionVariantService,
    question_variant_service,
)

client = TestClient(app)


# ------------------------------------------------------------------------------
# 1. KIỂM THỬ THUẬT TOÁN SERVICE ĐỔI SỐ LIỆU & NÂNG CAO
# ------------------------------------------------------------------------------

@pytest.mark.anyio
async def test_similar_quadratic_equation():
    """Kiểm tra AI tạo bài tập tương tự cho phương trình bậc 2 (đổi số liệu nghiệm đẹp)."""
    req = GenerateQuestionVariantRequest(
        original_question="Giải phương trình bậc hai: x^2 - 5x + 6 = 0",
        variant_type="SIMILAR",
        subject="TOAN",
        seed=42,
    )
    res = await question_variant_service.generate_variants(req)

    assert res.total_variants == 1
    variant = res.variants[0]
    assert variant.variant_type == "SIMILAR"
    assert variant.badge_color == "#16a34a"
    assert "x^2" in variant.question_content
    assert variant.difficulty_level == "Thông hiểu"
    assert variant.changed_parameters is not None
    assert "Delta" in variant.solution_guide
    assert variant.correct_answer != ""
    assert "【BÀI TẬP TƯƠNG TỰ - ĐỔI SỐ LIỆU】" in variant.canvas_card_text


@pytest.mark.anyio
async def test_advanced_quadratic_equation():
    """Kiểm tra AI tạo bài tập nâng cao cho phương trình bậc 2 (thêm tham số m & Vi-et)."""
    req = GenerateQuestionVariantRequest(
        original_question="Giải phương trình: x^2 - 4x + 3 = 0",
        variant_type="ADVANCED",
        subject="TOAN",
        seed=101,
    )
    res = await question_variant_service.generate_variants(req)

    assert res.total_variants == 1
    variant = res.variants[0]
    assert variant.variant_type == "ADVANCED"
    assert variant.badge_color == "#7c3aed"
    assert variant.difficulty_level == "Vận dụng cao"
    assert "tham số m" in variant.question_content or "m" in variant.question_content
    assert variant.added_conditions is not None
    assert variant.advanced_hint is not None
    assert "Vi-et" in variant.advanced_hint or "Delta" in variant.advanced_hint
    assert "【BÀI TẬP NÂNG CAO - HỌC SINH KHÁ GIỎI】" in variant.canvas_card_text


@pytest.mark.anyio
async def test_both_variants_generation():
    """Kiểm tra khi yêu cầu BOTH sẽ sinh đủ 2 biến thể (1 SIMILAR và 1 ADVANCED)."""
    req = GenerateQuestionVariantRequest(
        original_question="Giải phương trình: 2x^2 + 5x - 3 = 0",
        variant_type="BOTH",
        subject="TOAN",
        seed=2024,
    )
    res = await question_variant_service.generate_variants(req)

    assert res.total_variants == 2
    types = [v.variant_type for v in res.variants]
    assert "SIMILAR" in types
    assert "ADVANCED" in types


@pytest.mark.anyio
async def test_system_2var_equations():
    """Kiểm tra dạng hệ phương trình 2 ẩn (đổi số liệu và thêm tham số nghiệm nguyên)."""
    orig = "Giải hệ phương trình:\n  2x + y = 5\n  x - y = 1"
    
    # 1. Tương tự
    req_sim = GenerateQuestionVariantRequest(original_question=orig, variant_type="SIMILAR", seed=7)
    res_sim = await question_variant_service.generate_variants(req_sim)
    assert res_sim.variants[0].variant_type == "SIMILAR"
    assert "hệ phương trình" in res_sim.variants[0].question_content.lower()
    assert "(x; y)" in res_sim.variants[0].correct_answer

    # 2. Nâng cao
    req_adv = GenerateQuestionVariantRequest(original_question=orig, variant_type="ADVANCED", seed=8)
    res_adv = await question_variant_service.generate_variants(req_adv)
    assert res_adv.variants[0].variant_type == "ADVANCED"
    assert "tham số m" in res_adv.variants[0].title or "m" in res_adv.variants[0].question_content


@pytest.mark.anyio
async def test_motion_word_problem():
    """Kiểm tra bài toán thực tế chuyển động (quãng đường, vận tốc, ca nô dòng nước)."""
    orig = "Một ô tô đi từ A đến B với vận tốc 40 km/h trên quãng đường 120 km."

    # Tương tự
    res_sim = await question_variant_service.generate_variants(
        GenerateQuestionVariantRequest(original_question=orig, variant_type="SIMILAR", seed=15)
    )
    assert res_sim.variants[0].variant_type == "SIMILAR"
    assert "km/h" in res_sim.variants[0].question_content
    assert "giờ" in res_sim.variants[0].correct_answer

    # Nâng cao
    res_adv = await question_variant_service.generate_variants(
        GenerateQuestionVariantRequest(original_question=orig, variant_type="ADVANCED", seed=16)
    )
    assert res_adv.variants[0].variant_type == "ADVANCED"
    assert any(term in res_adv.variants[0].question_content for term in ["dòng nước", "ngược dòng", "xuôi dòng"])


@pytest.mark.anyio
async def test_geometry_triangle_pythagorean():
    """Kiểm tra dạng tam giác vuông và cực trị hình học."""
    orig = "Cho tam giác ABC vuông tại A có AB = 3 cm, AC = 4 cm. Tính cạnh huyền BC."

    # Tương tự
    res_sim = await question_variant_service.generate_variants(
        GenerateQuestionVariantRequest(original_question=orig, variant_type="SIMILAR", seed=99)
    )
    assert "tam giác" in res_sim.variants[0].question_content
    assert "BC =" in res_sim.variants[0].correct_answer

    # Nâng cao
    res_adv = await question_variant_service.generate_variants(
        GenerateQuestionVariantRequest(original_question=orig, variant_type="ADVANCED", seed=100)
    )
    assert "nhỏ nhất" in res_adv.variants[0].question_content or "cực trị" in res_adv.variants[0].title.lower()


@pytest.mark.anyio
async def test_physics_spring_pendulum():
    """Kiểm tra dạng Vật lý con lắc lò xo và va chạm mềm."""
    orig = "Một con lắc lò xo dao động điều hòa có độ cứng k = 100 N/m và khối lượng m = 250 g. Tính chu kỳ T."

    res_sim = await question_variant_service.generate_variants(
        GenerateQuestionVariantRequest(original_question=orig, variant_type="SIMILAR", subject="VAT_LY", seed=55)
    )
    assert "con lắc lò xo" in res_sim.variants[0].question_content
    assert "T =" in res_sim.variants[0].correct_answer

    res_adv = await question_variant_service.generate_variants(
        GenerateQuestionVariantRequest(original_question=orig, variant_type="ADVANCED", subject="VAT_LY", seed=56)
    )
    assert "va chạm" in res_adv.variants[0].question_content


@pytest.mark.anyio
async def test_general_numeric_fallback():
    """Kiểm tra cơ chế fallback số học cho đề bài tự do không thuộc mẫu có sẵn."""
    orig = "Có 10 quả cam và 20 quả táo trong rổ. Hỏi tổng số quả là bao nhiêu?"

    res_sim = await question_variant_service.generate_variants(
        GenerateQuestionVariantRequest(original_question=orig, variant_type="SIMILAR", seed=77)
    )
    assert res_sim.variants[0].variant_type == "SIMILAR"
    assert res_sim.variants[0].question_content != orig  # Số liệu đã đổi

    res_adv = await question_variant_service.generate_variants(
        GenerateQuestionVariantRequest(original_question=orig, variant_type="ADVANCED", seed=78)
    )
    assert res_adv.variants[0].variant_type == "ADVANCED"
    assert "Yêu cầu nâng cao" in res_adv.variants[0].question_content


# ------------------------------------------------------------------------------
# 2. KIỂM THỬ TÍCH HỢP REST API ENDPOINTS
# ------------------------------------------------------------------------------

def test_api_generate_variant_similar():
    """Kiểm thử gọi POST /api/v1/exam/generate-variant với SIMILAR."""
    payload = {
        "original_question": "Giải phương trình x^2 - 6x + 8 = 0",
        "variant_type": "SIMILAR",
        "subject": "TOAN",
        "seed": 1234,
    }
    response = client.post("/api/v1/exam/generate-variant", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total_variants"] == 1
    assert data["variants"][0]["variant_type"] == "SIMILAR"
    assert data["variants"][0]["badge_color"] == "#16a34a"


def test_api_generate_variant_advanced():
    """Kiểm thử gọi POST /api/v1/exam/generate-variant với ADVANCED."""
    payload = {
        "original_question": "Giải phương trình x^2 - 6x + 8 = 0",
        "variant_type": "ADVANCED",
        "subject": "TOAN",
        "seed": 5678,
    }
    response = client.post("/api/v1/exam/generate-variant", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total_variants"] == 1
    assert data["variants"][0]["variant_type"] == "ADVANCED"
    assert data["variants"][0]["badge_color"] == "#7c3aed"


def test_api_generate_variant_both():
    """Kiểm thử gọi POST /api/v1/exam/generate-variant với BOTH."""
    payload = {
        "original_question": "Giải hệ phương trình 3x - y = 5 và x + 2y = 4",
        "variant_type": "BOTH",
        "subject": "TOAN",
    }
    response = client.post("/api/v1/exam/generate-variant", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total_variants"] == 2
    types = [v["variant_type"] for v in data["variants"]]
    assert types == ["SIMILAR", "ADVANCED"]


def test_api_generate_similar_alias_routes():
    """Kiểm thử các route chuyên biệt cho bài tương tự (/exam/generate-similar-question & /quiz/generate-similar-question)."""
    payload = {"original_question": "Giải phương trình x^2 - 4x + 4 = 0"}

    # Route chính
    res1 = client.post("/api/v1/exam/generate-similar-question", json=payload)
    assert res1.status_code == 200
    assert res1.json()["variants"][0]["variant_type"] == "SIMILAR"

    # Route alias
    res2 = client.post("/api/v1/quiz/generate-similar-question", json=payload)
    assert res2.status_code == 200
    assert res2.json()["variants"][0]["variant_type"] == "SIMILAR"


def test_api_generate_advanced_alias_routes():
    """Kiểm thử các route chuyên biệt cho bài nâng cao (/exam/generate-advanced-question & /quiz/generate-advanced-question)."""
    payload = {"original_question": "Giải phương trình x^2 - 4x + 4 = 0"}

    # Route chính
    res1 = client.post("/api/v1/exam/generate-advanced-question", json=payload)
    assert res1.status_code == 200
    assert res1.json()["variants"][0]["variant_type"] == "ADVANCED"

    # Route alias
    res2 = client.post("/api/v1/quiz/generate-advanced-question", json=payload)
    assert res2.status_code == 200
    assert res2.json()["variants"][0]["variant_type"] == "ADVANCED"


def test_api_empty_question_validation_error():
    """Kiểm thử validation khi đề bài rỗng sẽ trả về lỗi HTTP 400 Bad Request."""
    payload = {"original_question": "   ", "variant_type": "SIMILAR"}
    response = client.post("/api/v1/exam/generate-variant", json=payload)
    assert response.status_code == 400
    assert "không được để trống" in response.json()["detail"]
