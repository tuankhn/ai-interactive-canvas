"""
Bộ kiểm thử toàn diện cho Task TF2850B:
Viết prompt AI bóc tách công thức Toán, Lý, Hóa và từ vựng Anh
Đảm bảo đáp ứng đầy đủ tiêu chí kỹ thuật:
- Đa môn: Toán (Phương trình, Tích phân, Ma trận), Lý (Dao động, Vector, Mạch điện), Hóa (Cân bằng, Mũi tên điều kiện, Khí/Kết tủa, SMILES 3D), Anh (Từ vựng, IPA, Từ loại, Câu ví dụ, Ngữ pháp)
- Xử lý payload JSON bền bỉ, loại bỏ markdown bọc ngoài và văn bản đệm
- Phục hồi lỗi, cô lập lỗi và không gây hiệu ứng sụp đổ domino
"""
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.ai.prompts import (
    MATH_SYSTEM_PROMPT,
    PHYSICS_SYSTEM_PROMPT,
    CHEMISTRY_SYSTEM_PROMPT,
    ENGLISH_SYSTEM_PROMPT,
    get_prompt_for_subject,
)
from app.ai.gemini_service import gemini_service, GeminiAIService
from app.schemas.canvas import RecognizeCanvasResponse, VisualizationData
from app.schemas.canvas_schema import RecognizeRequest, RecognizeResponse
from app.services.ai_recognition import ai_recognition_service
from tests.test_ai_recognition import generate_test_stroke_base64

client = TestClient(app)


# ==============================================================================
# 1. KIỂM THỬ SYSTEM PROMPTS CHO TỪNG MÔN HỌC (TASK TF2850B)
# ==============================================================================
class TestTF2850BPrompts:
    def test_math_prompt_content(self):
        """Prompt Toán học phải có hướng dẫn bóc tách Phương trình, Tích phân, Ma trận, Plotly"""
        prompt = get_prompt_for_subject("TOAN", grade_level="THPT")
        assert "Toán học" in prompt
        assert "THPT" in prompt
        # Phương trình, vi tích phân, đại số tuyến tính
        assert "phương trình" in prompt.lower() or "đại số" in prompt.lower()
        assert r"\int" in prompt or "tích phân" in prompt.lower()
        assert "ma trận" in prompt.lower() or "matrix" in prompt.lower()
        assert "plotly" in prompt.lower()
        assert "2D_GRAPH" in prompt

    def test_physics_prompt_content(self):
        """Prompt Vật lý phải có hướng dẫn bóc tách Dao động, Vector lực, Mạch điện RLC"""
        prompt = get_prompt_for_subject("VAT_LY", grade_level="THPT")
        assert "Vật lý" in prompt or "Vật Lý" in prompt
        assert "dao động" in prompt.lower()
        assert "vector" in prompt.lower() or "lực" in prompt.lower()
        assert "mạch điện" in prompt.lower() or "linh kiện" in prompt.lower()
        assert "OSCILLATION" in prompt
        assert "FORCE_VECTOR" in prompt
        assert "ELECTRIC_CIRCUIT" in prompt

    def test_chemistry_prompt_content(self):
        """Prompt Hóa học phải có hướng dẫn cân bằng phản ứng, điều kiện mũi tên, khí/kết tủa và SMILES 3D"""
        prompt = get_prompt_for_subject("HOA_HOC", grade_level="THPT")
        assert "Hóa học" in prompt or "Hóa" in prompt
        assert "cân bằng" in prompt.lower()
        # Ký hiệu trạng thái và điều kiện
        assert r"\uparrow" in prompt or "bay hơi" in prompt.lower()
        assert r"\downarrow" in prompt or "kết tủa" in prompt.lower()
        assert "SMILES" in prompt
        assert "3D_MOLECULE" in prompt
        assert "3dmol" in prompt

    def test_english_prompt_content(self):
        """Prompt Tiếng Anh phải có từ loại, phiên âm chuẩn IPA, câu ví dụ và phân tích ngữ pháp"""
        prompt = get_prompt_for_subject("TIENG_ANH", grade_level="THPT")
        assert "Tiếng Anh" in prompt or "ELT" in prompt
        assert "IPA" in prompt or "phiên âm" in prompt.lower()
        assert "từ loại" in prompt.lower() or "word_type" in prompt
        assert "ví dụ" in prompt.lower() or "example_sentence" in prompt
        assert "ngữ pháp" in prompt.lower() or "grammar" in prompt.lower()
        assert "IMAGE_ILLUSTRATION" in prompt

    def test_prompt_subject_normalization(self):
        """Kiểm tra chuẩn hóa mã môn linh hoạt không phân biệt hoa thường và hỗ trợ alias"""
        assert get_prompt_for_subject("math") == get_prompt_for_subject("TOAN")
        assert get_prompt_for_subject("phys") == get_prompt_for_subject("VAT_LY")
        assert get_prompt_for_subject("chem") == get_prompt_for_subject("HOA_HOC")
        assert get_prompt_for_subject("eng") == get_prompt_for_subject("TIENG_ANH")
        # Hỗ trợ cả topic modifier
        assert get_prompt_for_subject("MATH:INTEGRAL") == get_prompt_for_subject("TOAN")
        assert get_prompt_for_subject("HOA_HOC#ESTE") == get_prompt_for_subject("HOA_HOC")
        # Fallback về Toán nếu môn không xác định
        assert get_prompt_for_subject("UNKNOWN_SUBJECT") == get_prompt_for_subject("TOAN")


# ==============================================================================
# 2. KIỂM THỬ ENGINE MOCK ĐA MÔN ĐẦY ĐỦ CÁC KỊCH BẢN CHUYÊN SÂU
# ==============================================================================
class TestTF2850BMockScenarios:
    @pytest.mark.anyio
    async def test_math_mock_scenarios(self):
        """Kiểm tra 3 kịch bản Toán: Hàm bậc hai, Tích phân, Ma trận"""
        b64 = generate_test_stroke_base64()

        # 1. Hàm bậc hai
        res_eq = await gemini_service.analyze_board(b64, subject="MATH:EQUATION")
        assert res_eq.subject in ["TOAN", "MATH"]
        assert "x^2" in res_eq.latex
        assert res_eq.subject_details["topic"] == "EQUATION"
        assert res_eq.visualization is not None
        assert res_eq.visualization.type == "2D_GRAPH"

        # 2. Tích phân
        res_int = await gemini_service.analyze_board(b64, subject="MATH:INTEGRAL")
        assert r"\int" in res_int.latex
        assert res_int.subject_details["topic"] == "INTEGRAL"
        assert res_int.subject_details["antiderivative"] == "x^3 + x^2"

        # 3. Ma trận
        res_mat = await gemini_service.analyze_board(b64, subject="MATH:MATRIX")
        assert r"\begin{pmatrix}" in res_mat.latex
        assert res_mat.subject_details["topic"] == "MATRIX"
        assert res_mat.subject_details["determinant"] == -2

    @pytest.mark.anyio
    async def test_physics_mock_scenarios(self):
        """Kiểm tra 3 kịch bản Vật lý: Vector lực, Dao động điều hòa, Mạch điện RLC"""
        b64 = generate_test_stroke_base64()

        # 1. Vector lực
        res_force = await gemini_service.analyze_board(b64, subject="VAT_LY:FORCE")
        assert r"\vec{F}" in res_force.latex
        assert res_force.subject_details["topic"] == "FORCE_VECTOR"

        # 2. Dao động điều hòa
        res_osc = await gemini_service.analyze_board(b64, subject="VAT_LY:OSCILLATION")
        assert r"\cos" in res_osc.latex
        assert res_osc.subject_details["topic"] == "OSCILLATION"
        assert res_osc.subject_details["amplitude"] == "5 cm"
        assert res_osc.visualization.type == "2D_GRAPH"

        # 3. Mạch điện RLC
        res_circ = await gemini_service.analyze_board(b64, subject="VAT_LY:CIRCUIT")
        assert "Z" in res_circ.latex
        assert res_circ.subject_details["topic"] == "ELECTRIC_CIRCUIT"
        assert "R" in res_circ.subject_details["components"][0]

    @pytest.mark.anyio
    async def test_chemistry_mock_scenarios(self):
        """Kiểm tra 3 kịch bản Hóa học: Nước (vô cơ), Este hóa (hữu cơ 3D), Nhiệt phân thuốc tím (sinh khí)"""
        b64 = generate_test_stroke_base64()

        # 1. Nước (Vô cơ cơ bản)
        res_water = await gemini_service.analyze_board(b64, subject="HOA_HOC:WATER")
        assert "{H}_2" in res_water.latex or "H2O" in res_water.recognized_text
        assert res_water.subject_details["topic"] == "INORGANIC_REACTION"
        assert res_water.subject_details["smiles"] == "O"
        assert res_water.visualization.type == "3D_MOLECULE"

        # 2. Este hóa (Hữu cơ & SMILES)
        res_este = await gemini_service.analyze_board(b64, subject="HOA_HOC:ESTE")
        assert r"\xrightleftharpoons" in res_este.latex
        assert res_este.subject_details["topic"] == "ORGANIC_REACTION"
        assert res_este.subject_details["smiles"] == "CCOC(=O)C"
        assert res_este.subject_details["iupac_name"] == "Ethyl acetate"
        assert res_este.visualization.type == "3D_MOLECULE"

        # 3. Nhiệt phân thuốc tím (KMnO4 sinh khí O2)
        res_kmno4 = await gemini_service.analyze_board(b64, subject="HOA_HOC:KMNO4")
        assert r"\uparrow" in res_kmno4.latex
        assert res_kmno4.subject_details["topic"] == "INORGANIC_REACTION"
        assert "O2" in res_kmno4.subject_details["gas_released"]

    @pytest.mark.anyio
    async def test_english_mock_scenarios(self):
        """Kiểm tra 3 kịch bản Tiếng Anh: Danh từ + IPA, Tính từ, Câu ngữ pháp điều kiện"""
        b64 = generate_test_stroke_base64()

        # 1. Từ vựng Danh từ + IPA
        res_edu = await gemini_service.analyze_board(b64, subject="TIENG_ANH:VOCAB")
        assert res_edu.subject == "TIENG_ANH"
        assert res_edu.subject_details["word"] == "Education"
        assert "/ˌedʒuˈkeɪʃn/" in res_edu.subject_details["ipa"]
        assert "giáo dục" in res_edu.subject_details["vietnamese_meaning"].lower()
        assert len(res_edu.subject_details["example_sentence"]) > 0

        # 2. Từ vựng Tính từ
        res_adj = await gemini_service.analyze_board(b64, subject="TIENG_ANH:ADJ")
        assert res_adj.subject_details["word"] == "Interactive"
        assert "/ˌɪntərˈæktɪv/" in res_adj.subject_details["ipa"]
        assert "tương tác" in res_adj.subject_details["vietnamese_meaning"].lower()

        # 3. Câu ngữ pháp điều kiện
        res_gram = await gemini_service.analyze_board(b64, subject="TIENG_ANH:GRAMMAR")
        assert res_gram.subject_details["topic"] == "GRAMMAR_SENTENCE"
        assert "First Conditional" in res_gram.subject_details["grammar_structure"]


# ==============================================================================
# 3. KIỂM THỬ XỬ LÝ PAYLOAD GEMINI VÀ CƠ CHẾ CHỐNG LỖI CASCADING (FAULT TOLERANCE)
# ==============================================================================
class TestTF2850BJsonRobustness:
    @pytest.mark.anyio
    async def test_parse_json_with_surrounding_conversational_text(self):
        """Kiểm tra regex trích xuất JSON khi Gemini trả về kèm văn bản chào hỏi hoặc giải thích"""
        simulated_raw = """
        Xin chào thầy cô! Dưới đây là kết quả phân tích nét vẽ bảng:
        {
            "recognized_text": "C2H5OH + 3O2 -> 2CO2 + 3H2O",
            "latex": "\\\\text{C}_2\\\\text{H}_5\\\\text{OH} + 3\\\\text{O}_2 \\\\xrightarrow{t^\\\\circ} 2\\\\text{CO}_2 + 3\\\\text{H}_2\\\\text{O}",
            "subject": "HOA_HOC",
            "confidence": 0.99,
            "has_ambiguity": false,
            "ambiguous_tokens": [],
            "subject_details": {
                "topic": "COMBUSTION",
                "smiles": "CCO"
            },
            "visualization": {
                "type": "3D_MOLECULE",
                "engine": "3dmol",
                "title": "Mô hình phân tử Ethanol",
                "parameters": {"smiles": "CCO"},
                "latex_formula": null
            },
            "explanation": "Phản ứng đốt cháy hoàn toàn rượu etylic tỏa nhiều nhiệt."
        }
        Chúc buổi học trên bảng vẽ tương tác thành công rực rỡ!
        """

        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = simulated_raw
        mock_model.generate_content.return_value = mock_response

        service = GeminiAIService()
        service.is_configured = True
        service.model = mock_model
        service._client_type = "google-generativeai"

        b64 = generate_test_stroke_base64()
        res = await service.analyze_board(b64, subject="HOA_HOC")

        assert res.subject == "HOA_HOC"
        assert "CO2" in res.recognized_text or "{CO}_2" in res.latex
        assert res.subject_details["smiles"] == "CCO"
        assert res.visualization.type == "3D_MOLECULE"

    @pytest.mark.anyio
    async def test_parse_json_fallback_on_corrupt_response(self):
        """Khi Gemini trả về chuỗi rác không thể parse JSON, hệ thống tự động fallback sang mock an toàn, không sập"""
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "LỖI: Mô hình AI tạm thời quá tải hoặc không đọc được định dạng ảnh."
        mock_model.generate_content.return_value = mock_response

        service = GeminiAIService()
        service.is_configured = True
        service.model = mock_model
        service._client_type = "google-generativeai"

        b64 = generate_test_stroke_base64()
        res = await service.analyze_board(b64, subject="TIENG_ANH")

        # Hệ thống kích hoạt fallback an toàn, không gây crash hoặc domino
        assert res is not None
        assert "TIENG_ANH" in res.subject or "ENG" in res.subject
        assert res.subject_details is not None


# ==============================================================================
# 4. KIỂM THỬ END-TO-END PIPELINE & API ENDPOINTS
# ==============================================================================
class TestTF2850BApiIntegration:
    @pytest.mark.anyio
    async def test_pipeline_propagates_subject_details(self):
        """Kiểm tra tầng ai_recognition_service truyền đầy đủ subject_details từ Gemini sang RecognizeResponse"""
        b64 = generate_test_stroke_base64()
        req = RecognizeRequest(
            session_id="session-test-tf2850b",
            room_id="room-test",
            image_base64=b64,
            subject="TIENG_ANH:VOCAB",
            provider="gemini"
        )
        resp: RecognizeResponse = await ai_recognition_service.recognize_canvas_strokes(req)
        assert "TIENG_ANH" in resp.subject or "ENG" in resp.subject
        assert resp.subject_details is not None
        assert resp.subject_details.get("word") == "Education"
        assert "/ˌedʒuˈkeɪʃn/" in resp.subject_details.get("ipa", "")

    def test_http_api_recognize_english_subject_details(self):
        """Kiểm tra gọi POST /api/v1/recognize trả về subject_details cho môn Tiếng Anh"""
        b64 = generate_test_stroke_base64()
        payload = {
            "session_id": "session-10a1",
            "room_id": "room-10a1",
            "subject": "TIENG_ANH:VOCAB",
            "page_number": 1,
            "image_base64": b64,
            "debounce_ms": 800,
            "provider": "auto"
        }
        response = client.post("/api/v1/recognize", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "TIENG_ANH" in data["subject"] or "ENG" in data["subject"]
        assert "subject_details" in data
        assert data["subject_details"]["word"] == "Education"
        assert "/ˌedʒuˈkeɪʃn/" in data["subject_details"]["ipa"]

    def test_http_api_recognize_chemistry_subject_details(self):
        """Kiểm tra gọi POST /api/v1/recognize trả về subject_details cho môn Hóa học (SMILES 3D)"""
        b64 = generate_test_stroke_base64()
        payload = {
            "session_id": "session-10a1",
            "room_id": "room-10a1",
            "subject": "HOA_HOC:ESTE",
            "page_number": 1,
            "image_base64": b64,
            "debounce_ms": 800,
            "provider": "gemini"
        }
        response = client.post("/api/v1/recognize", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "HOA_HOC" in data["subject"] or "CHEM" in data["subject"]
        assert "subject_details" in data
        assert data["subject_details"]["smiles"] == "CCOC(=O)C"
        assert data["subject_details"]["iupac_name"] == "Ethyl acetate"
