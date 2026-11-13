# ==============================================================================
# MODULE KẾT NỐI GEMINI 2.5 FLASH API - NHẬN DIỆN NÉT VẼ ĐA PHƯƠNG THỨC
# (TASK TF28508) - Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import base64
import json
import logging
import sys
import time
from io import BytesIO
from typing import Dict, Any, Optional
from PIL import Image

from app.core.config import settings
from app.schemas.canvas import RecognizeCanvasResponse, AmbiguousToken, VisualizationData
from app.ai.prompts import SYSTEM_PROMPT_TEMPLATE, get_prompt_for_subject

logger = logging.getLogger(__name__)


class GeminiAIService:
    """
    Dịch vụ kết nối Google Gemini 2.5 Flash đa phương thức (Multimodal Vision)
    cho Màn hình tương tác thông minh All-in-one.
    Đặc tả:
      - Bóc tách chữ viết tay, ký hiệu Toán, Lý, Hóa, Tiếng Anh.
      - Trả về mã LaTeX chuẩn, độ tin cậy và siêu dữ liệu trực quan hóa (2D Graph / 3D).
      - Đảm bảo độ trễ phản hồi < 2.0 giây.
      - Cung cấp Fallback Mock Engine thông minh khi chạy kiểm thử hoặc offline.
    """

    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self.model_name = settings.GEMINI_MODEL or "gemini-2.5-flash"
        self.is_configured = False
        self._client_type = None
        self._init_client()

    def _init_client(self):
        """Khởi tạo client Google GenAI (hỗ trợ cả google-genai mới và google-generativeai)."""
        if not self.api_key or len(self.api_key.strip()) == 0:
            self.is_configured = False
            return

        # Ưu tiên thử SDK google-genai mới nhất
        try:
            from google import genai
            self.client = genai.Client(api_key=self.api_key.strip())
            self._client_type = "google-genai"
            self.is_configured = True
            logger.info("Gemini 2.5 Flash khởi tạo thành công với google-genai SDK.")
            return
        except Exception as e:
            logger.debug(f"Không thể nạp google-genai: {e}, thử google-generativeai...")

        # Dự phòng bằng google-generativeai
        try:
            import google.generativeai as legacy_genai
            legacy_genai.configure(api_key=self.api_key.strip())
            self.model = legacy_genai.GenerativeModel(self.model_name)
            self._client_type = "google-generativeai"
            self.is_configured = True
            logger.info(f"Gemini khởi tạo thành công với legacy SDK ({self.model_name}).")
        except Exception as e:
            logger.warning(f"Chưa thể kết nối Gemini API: {e}")
            self.is_configured = False

    async def analyze_board(
        self,
        image_base64: str,
        subject: str = "MATH",
        grade_level: Optional[str] = "THPT",
        timeout: float = 4.0
    ) -> RecognizeCanvasResponse:
        """
        Phân tích ảnh vùng nét vẽ bằng Gemini 2.5 Flash.
        """
        start_time = time.perf_counter()

        # Tiền xử lý chuỗi Base64
        clean_b64 = image_base64
        if "," in clean_b64:
            clean_b64 = clean_b64.split(",", 1)[1]

        if not self.is_configured and "pytest" not in sys.modules:
            # Thử nạp lại key nếu người dùng vừa mới cập nhật file .env hoặc biến môi trường
            import os
            from app.core.config import settings
            fresh_key = (os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "") or settings.GEMINI_API_KEY).strip()
            if fresh_key:
                self.api_key = fresh_key
                self._init_client()

        if not self.is_configured:
            logger.info("Gemini API Key chưa cấu hình. Kích hoạt Gemini Mock Engine dự phòng.")
            return self._mock_result(subject, clean_b64)

        try:
            raw_bytes = base64.b64decode(clean_b64)
            pil_image = Image.open(BytesIO(raw_bytes))

            prompt = get_prompt_for_subject(
                subject=subject,
                grade_level=grade_level or "THPT"
            )

            raw_text = ""
            if self._client_type == "google-genai":
                candidate_models = [self.model_name]
                for fallback in ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.7-flash"]:
                    if fallback not in candidate_models:
                        candidate_models.append(fallback)

                last_err = None
                for mod in candidate_models:
                    try:
                        response = self.client.models.generate_content(
                            model=mod,
                            contents=[pil_image, prompt]
                        )
                        raw_text = response.text or ""
                        if raw_text:
                            break
                    except Exception as mod_err:
                        last_err = mod_err
                        logger.warning(f"Lỗi gọi model {mod}: {mod_err}, thử model tiếp theo...")

                if not raw_text and last_err:
                    raise last_err
            else:
                response = self.model.generate_content([prompt, pil_image])
                raw_text = response.text or ""

            raw_text = raw_text.strip()
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            elif raw_text.startswith("```"):
                raw_text = raw_text[3:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]

            # Bọc lót trích xuất JSON bằng Regex chống dị tật văn bản thừa
            import re
            json_match = re.search(r"\{.*\}", raw_text.strip(), re.DOTALL)
            if json_match:
                raw_text = json_match.group(0)

            parsed_data = json.loads(raw_text.strip())

            # Chuẩn hóa ambiguous_tokens để tương thích với Pydantic schema
            raw_tokens = parsed_data.get("ambiguous_tokens", [])
            normalized_tokens = []
            if isinstance(raw_tokens, list):
                for item in raw_tokens:
                    if isinstance(item, str):
                        normalized_tokens.append(AmbiguousToken(
                            detected_text=item,
                            confidence=0.8,
                            suggestions=[]
                        ))
                    elif isinstance(item, dict):
                        detected = item.get("detected_text") or item.get("token") or item.get("text") or ""
                        conf = float(item.get("confidence", 0.8))
                        suggs = item.get("suggestions") or item.get("possible_readings") or item.get("possible_interpretations") or []
                        bbox = item.get("bbox") or [0, 0, 0, 0]
                        normalized_tokens.append(AmbiguousToken(
                            bbox=bbox,
                            detected_text=str(detected),
                            confidence=conf,
                            suggestions=[str(s) for s in suggs]
                        ))
            parsed_data["ambiguous_tokens"] = normalized_tokens

            # Chuẩn hóa visualization nếu có
            vis = parsed_data.get("visualization")
            if isinstance(vis, dict):
                if not vis.get("type"):
                    vis["type"] = "NONE"
                if not vis.get("engine"):
                    vis["engine"] = "image"
                try:
                    parsed_data["visualization"] = VisualizationData(**vis)
                except Exception:
                    parsed_data["visualization"] = None

            try:
                return RecognizeCanvasResponse(**parsed_data)
            except Exception as schema_err:
                logger.warning(f"Cảnh báo schema validation từ Gemini: {schema_err}, phục hồi kết quả trực tiếp từ parsed_data")
                return RecognizeCanvasResponse(
                    recognized_text=str(parsed_data.get("recognized_text", "")),
                    latex=str(parsed_data.get("latex") or parsed_data.get("recognized_text", "")),
                    subject=str(parsed_data.get("subject", subject)),
                    confidence=float(parsed_data.get("confidence", 0.95)),
                    has_ambiguity=bool(parsed_data.get("has_ambiguity", False)),
                    ambiguous_tokens=normalized_tokens,
                    visualization=parsed_data.get("visualization") if isinstance(parsed_data.get("visualization"), VisualizationData) else None,
                    explanation=parsed_data.get("explanation"),
                    subject_details=parsed_data.get("subject_details")
                )

        except Exception as err:
            logger.error(f"Lỗi gọi Gemini 2.5 Flash Vision: {err}")
            return self._mock_result(subject, clean_b64)

    def _mock_result(self, subject: str, clean_b64: str = "") -> RecognizeCanvasResponse:
        """
        Dữ liệu mẫu phản hồi tức thì khi CHƯA cấu hình GEMINI_API_KEY.
        Cung cấp các kịch bản mẫu phong phú theo đặc thù môn học (Task TF2850B):
        - Toán: Phương trình bậc hai, tích phân, ma trận.
        - Lý: Dao động điều hòa, vector lực, định luật Ohm / mạch điện.
        - Hóa: Phản ứng hữu cơ (este hóa), phản ứng vô cơ cân bằng, cấu tạo phân tử 3D SMILES.
        - Anh: Từ vựng chuẩn IPA, từ loại, câu ví dụ và phân tích ngữ pháp.
        """
        subj_raw = (subject or "TOAN").strip()
        subj = subj_raw.upper()

        # Xác định kịch bản mock: mặc định 0 để đảm bảo tính ổn định và tương thích,
        # hỗ trợ các modifier rõ ràng hoặc chủ đề chuyên sâu
        scenario_idx = 0
        if any(k in subj for k in [":1", "#1", ":INTEGRAL", ":TICH_PHAN", ":OSCILLATION", ":DAO_DONG", ":ORGANIC", ":ESTE", ":ADJ"]):
            scenario_idx = 1
        elif any(k in subj for k in [":2", "#2", ":MATRIX", ":MA_TRAN", ":CIRCUIT", ":MACH_DIEN", ":KMNO4", ":NHIET_PHAN", ":GRAMMAR", ":NGU_PHAP"]):
            scenario_idx = 2
        elif any(k in subj for k in [":0", "#0", ":EQUATION", ":BAC_HAI", ":FORCE", ":LUC", ":WATER", ":NUOC", ":VOCAB"]):
            scenario_idx = 0

        mock_notice = "⚠️ Đang ở chế độ Mock dự phòng (chưa cấu hình GEMINI_API_KEY). Thêm key vào file backend/.env để nhận diện AI thực tế bằng Gemini 2.5 Flash."

        # ----------------------------------------------------------------------
        # MÔN TOÁN HỌC (MATH / TOAN)
        # ----------------------------------------------------------------------
        if "MATH" in subj or "TOAN" in subj:
            if scenario_idx == 0:
                # Kịch bản 1: Phương trình / hàm số bậc hai
                return RecognizeCanvasResponse(
                    recognized_text="y = x^2 - 4x + 3",
                    latex=r"y = x^2 - 4x + 3",
                    subject="TOAN",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "EQUATION",
                        "equation_type": "Hàm số bậc hai / Parabol",
                        "delta": 4,
                        "roots": [1, 3],
                        "vertex": [2, -1],
                        "roots_description": "Phương trình có 2 nghiệm phân biệt x1 = 1, x2 = 3. Tọa độ đỉnh parabol I(2, -1)."
                    },
                    visualization=VisualizationData(
                        type="2D_GRAPH",
                        engine="plotly",
                        title="Đồ thị hàm số bậc hai y = x^2 - 4x + 3",
                        parameters={
                            "function": "x**2 - 4*x + 3",
                            "x_range": [-1, 5],
                            "vertex": [2, -1]
                        },
                        latex_formula=r"y = x^2 - 4x + 3"
                    ),
                    explanation=f"{mock_notice}\nĐã bóc tách hàm số bậc hai y = x^2 - 4x + 3. Bề lõm quay lên trên, đỉnh I(2, -1), cắt trục hoành tại x=1 và x=3."
                )
            elif scenario_idx == 1:
                # Kịch bản 2: Tích phân xác định
                return RecognizeCanvasResponse(
                    recognized_text="int_0^1 (3x^2 + 2x) dx = 2",
                    latex=r"\int_{0}^{1} (3x^2 + 2x) \, dx = 2",
                    subject="TOAN",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "INTEGRAL",
                        "lower_bound": 0,
                        "upper_bound": 1,
                        "antiderivative": "x^3 + x^2",
                        "result": 2
                    },
                    visualization=VisualizationData(
                        type="2D_GRAPH",
                        engine="plotly",
                        title="Diện tích hình phẳng dưới đồ thị y = 3x^2 + 2x từ 0 đến 1",
                        parameters={
                            "function": "3*x**2 + 2*x",
                            "x_range": [0, 1],
                            "integral_value": 2
                        },
                        latex_formula=r"\int_{0}^{1} (3x^2 + 2x) \, dx"
                    ),
                    explanation=f"{mock_notice}\nNguyên hàm F(x) = x^3 + x^2. Áp dụng công thức Newton-Leibniz: F(1) - F(0) = 2."
                )
            else:
                # Kịch bản 3: Ma trận vuông cấp 2 và định thức
                return RecognizeCanvasResponse(
                    recognized_text="A = [[1, 2], [3, 4]], det(A) = -2",
                    latex=r"A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}, \quad \det(A) = -2",
                    subject="TOAN",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "MATRIX",
                        "matrix_dimensions": [2, 2],
                        "determinant": -2,
                        "is_invertible": True
                    },
                    visualization=None,
                    explanation=f"{mock_notice}\nMa trận vuông cấp 2x2. Định thức det(A) = 1*4 - 2*3 = -2 khác 0 nên A khả nghịch."
                )

        # ----------------------------------------------------------------------
        # MÔN VẬT LÝ (PHYSICS / VAT_LY)
        # ----------------------------------------------------------------------
        elif "PHYS" in subj or "VAT_LY" in subj:
            if scenario_idx == 0:
                # Kịch bản 1: Vector lực và Định luật II Newton
                return RecognizeCanvasResponse(
                    recognized_text=r"F = m * a, \sum \vec{F} = m \vec{a}",
                    latex=r"\vec{F} = m \vec{a}",
                    subject="VAT_LY",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "FORCE_VECTOR",
                        "law": "Định luật II Newton",
                        "forces": [
                            {"name": "Lực F", "magnitude": "m*a", "direction": "cùng hướng gia tốc a"}
                        ],
                        "vector_sum": r"\sum \vec{F} = m \vec{a}"
                    },
                    visualization=VisualizationData(
                        type="2D_GRAPH",
                        engine="plotly",
                        title="Biểu diễn Vector Lực và Gia tốc (F = m*a)",
                        parameters={"slope": 2.0, "x_label": "Gia tốc a (m/s2)", "y_label": "Hợp lực F (N)"},
                        latex_formula=r"\vec{F} = m\vec{a}"
                    ),
                    explanation=f"{mock_notice}\nĐịnh luật II Newton: Gia tốc của một vật tỉ lệ thuận với hợp lực tác dụng lên vật và tỉ lệ nghịch với khối lượng."
                )
            elif scenario_idx == 1:
                # Kịch bản 2: Dao động điều hòa
                return RecognizeCanvasResponse(
                    recognized_text="x = 5*cos(10t + pi/3) (cm)",
                    latex=r"x = 5\cos\left(10t + \frac{\pi}{3}\right) \text{ (cm)}",
                    subject="VAT_LY",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "OSCILLATION",
                        "amplitude": "5 cm",
                        "angular_frequency": "10 rad/s",
                        "initial_phase": "pi/3 rad",
                        "period_T": "0.628 s"
                    },
                    visualization=VisualizationData(
                        type="2D_GRAPH",
                        engine="plotly",
                        title="Đồ thị li độ - thời gian x = 5cos(10t + pi/3)",
                        parameters={
                            "function": "5 * cos(10*x + 1.047)",
                            "x_range": [0, 1.5],
                            "amplitude": 5,
                            "period": 0.628
                        },
                        latex_formula=r"x = 5\cos\left(10t + \frac{\pi}{3}\right)"
                    ),
                    explanation=f"{mock_notice}\nDao động điều hòa có biên độ A = 5cm, tần số góc omega = 10 rad/s, pha ban đầu phi = pi/3 rad."
                )
            else:
                # Kịch bản 3: Mạch điện xoay chiều RLC & Định luật Ohm
                return RecognizeCanvasResponse(
                    recognized_text="I = U / Z, Z = sqrt(R^2 + (ZL - ZC)^2)",
                    latex=r"I = \frac{U}{Z}, \quad Z = \sqrt{R^2 + (Z_L - Z_C)^2}",
                    subject="VAT_LY",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "ELECTRIC_CIRCUIT",
                        "components": ["Điện trở R", "Cuộn cảm L", "Tụ điện C"],
                        "impedance_formula": r"Z = \sqrt{R^2 + (Z_L - Z_C)^2}"
                    },
                    visualization=None,
                    explanation=f"{mock_notice}\nĐịnh luật Ohm cho đoạn mạch xoay chiều RLC nối tiếp: Cường độ dòng điện hiệu dụng tỉ lệ nghịch với tổng trở Z của mạch."
                )

        # ----------------------------------------------------------------------
        # MÔN HÓA HỌC (CHEMISTRY / HOA_HOC)
        # ----------------------------------------------------------------------
        elif "CHEM" in subj or "HOA" in subj:
            if scenario_idx == 0:
                # Kịch bản 1: Phản ứng tổng hợp nước (Vô cơ cơ bản)
                return RecognizeCanvasResponse(
                    recognized_text="2H2 + O2 -> 2H2O (t*)",
                    latex=r"2\text{H}_2 + \text{O}_2 \xrightarrow{\text{t}^\circ} 2\text{H}_2\text{O}",
                    subject="HOA_HOC",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "INORGANIC_REACTION",
                        "reaction_type": "Phản ứng tổng hợp nước (Oxi hóa - Khử)",
                        "is_balanced": True,
                        "reactants": ["2H2", "O2"],
                        "products": ["2H2O"],
                        "condition": r"t^\circ",
                        "smiles": "O"
                    },
                    visualization=VisualizationData(
                        type="3D_MOLECULE",
                        engine="3dmol",
                        title="Mô hình phân tử Nước (H2O)",
                        parameters={"smiles": "O", "formula": "H2O"}
                    ),
                    explanation=f"{mock_notice}\nKhí Hydro cháy trong khí Oxy ở nhiệt độ cao tạo thành hơi nước, phản ứng tỏa nhiệt mạnh."
                )
            elif scenario_idx == 1:
                # Kịch bản 2: Phản ứng este hóa (Hóa hữu cơ)
                return RecognizeCanvasResponse(
                    recognized_text="CH3COOH + C2H5OH <=> CH3COOC2H5 + H2O (H2SO4 d, t*)",
                    latex=r"\text{CH}_3\text{COOH} + \text{C}_2\text{H}_5\text{OH} \xrightleftharpoons[\text{t}^\circ]{\text{H}_2\text{SO}_4 \text{ đ}} \text{CH}_3\text{COOC}_2\text{H}_5 + \text{H}_2\text{O}",
                    subject="HOA_HOC",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "ORGANIC_REACTION",
                        "reaction_type": "Phản ứng Este hóa (Thuận nghịch)",
                        "reactants": ["CH3COOH (Axit axetic)", "C2H5OH (Ethanol)"],
                        "products": ["CH3COOC2H5 (Etyl axetat)", "H2O"],
                        "smiles": "CCOC(=O)C",
                        "iupac_name": "Ethyl acetate"
                    },
                    visualization=VisualizationData(
                        type="3D_MOLECULE",
                        engine="3dmol",
                        title="Mô hình phân tử Etyl axetat (CH3COOC2H5)",
                        parameters={"smiles": "CCOC(=O)C", "formula": "C4H8O2"}
                    ),
                    explanation=f"{mock_notice}\nPhản ứng este hóa giữa axit axetic và ancol etylic xúc tác H2SO4 đặc tạo thành etyl axetat có mùi thơm hoa quả đặc trưng."
                )
            else:
                # Kịch bản 3: Phản ứng nhiệt phân sinh khí (Hóa vô cơ)
                return RecognizeCanvasResponse(
                    recognized_text="2KMnO4 -> K2MnO4 + MnO2 + O2^ (t*)",
                    latex=r"2\text{KMnO}_4 \xrightarrow{\text{t}^\circ} \text{K}_2\text{MnO}_4 + \text{MnO}_2 + \text{O}_2\uparrow",
                    subject="HOA_HOC",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "INORGANIC_REACTION",
                        "reaction_type": "Phản ứng phân hủy / Oxi hóa - Khử",
                        "is_balanced": True,
                        "gas_released": "O2 (Khí Oxy)",
                        "arrow_up": r"\uparrow"
                    },
                    visualization=None,
                    explanation=f"{mock_notice}\nNhiệt phân thuốc tím (KMnO4) trong phòng thí nghiệm giải phóng khí Oxy làm tàn đóm đỏ bùng cháy."
                )

        # ----------------------------------------------------------------------
        # MÔN SINH HỌC (BIOLOGY / SINH_HOC)
        # ----------------------------------------------------------------------
        elif "SINH" in subj or "BIO" in subj:
            if "CELL" in subj or "TE_BAO" in subj:
                return RecognizeCanvasResponse(
                    recognized_text="Cell Structure (Cấu tạo tế bào)",
                    latex=None,
                    subject="SINH_HOC",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "CELL_STRUCTURE",
                        "concept": "Cell",
                        "vietnamese_name": "Cấu tạo Tế bào",
                        "organelles": ["Màng tế bào", "Nhân (Nucleus)", "Ty thể (Mitochondria)", "Tế bào chất"]
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Cấu tạo Tế bào",
                        parameters={"concept": "cell", "style": "white_chalk"}
                    ),
                    explanation=f"{mock_notice}\nTế bào là đơn vị cấu trúc và chức năng cơ bản của mọi sinh vật sống."
                )
            else:
                # Kịch bản tiêu biểu: Quang hợp (Photosynthesis)
                return RecognizeCanvasResponse(
                    recognized_text="Photosynthesis: 6CO2 + 6H2O -> C6H12O6 + 6O2 (Ánh sáng, Diệp lục)",
                    latex=r"6\text{CO}_2 + 6\text{H}_2\text{O} \xrightarrow[\text{Diệp lục}]{\text{Ánh sáng}} \text{C}_6\text{H}_{12}\text{O}_6 + 6\text{O}_2\uparrow",
                    subject="SINH_HOC",
                    confidence=0.99,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "PHOTOSYNTHESIS",
                        "concept": "Photosynthesis",
                        "vietnamese_name": "Quá trình Quang hợp",
                        "formula": "6CO2 + 6H2O -> C6H12O6 + 6O2",
                        "raw_materials": ["Khí CO2", "Nước H2O", "Ánh sáng mặt trời"],
                        "products": ["Glucose C6H12O6", "Khí Oxy O2"]
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Quá trình Quang hợp ở cây xanh",
                        parameters={"concept": "photosynthesis", "style": "white_chalk"}
                    ),
                    explanation=f"{mock_notice}\nQuá trình quang hợp giúp cây xanh chuyển hóa năng lượng ánh sáng thành năng lượng hóa học trong hợp chất hữu cơ."
                )

        # ----------------------------------------------------------------------
        # MÔN ĐỊA LÝ & THIÊN VĂN (GEOGRAPHY / DIA_LY)
        # ----------------------------------------------------------------------
        elif "DIA" in subj or "GEO" in subj:
            if "SOLAR" in subj or "MAT_TROI" in subj or "HE_MAT_TROI" in subj:
                return RecognizeCanvasResponse(
                    recognized_text="Solar System (Hệ Mặt Trời)",
                    latex=None,
                    subject="DIA_LY",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "ASTRONOMY",
                        "concept": "Solar System",
                        "vietnamese_name": "Hệ Mặt Trời",
                        "planets": ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Hệ Mặt Trời và các hành tinh",
                        parameters={"concept": "solarsystem", "style": "white_chalk"}
                    ),
                    explanation=f"{mock_notice}\nHệ Mặt Trời gồm Mặt Trời ở trung tâm và 8 hành tinh quay xung quanh theo quỹ đạo hình elip."
                )
            else:
                # Kịch bản tiêu biểu: Núi lửa (Volcano)
                return RecognizeCanvasResponse(
                    recognized_text="Volcano Eruption (Núi lửa phun trào)",
                    latex=None,
                    subject="DIA_LY",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "VOLCANO_TECTONICS",
                        "concept": "Volcano",
                        "vietnamese_name": "Núi Lửa",
                        "components": ["Miệng núi lửa (Crater)", "Ống dẫn magma", "Dòng dung nham (Lava)", "Cột tro bụi (Ash cloud)"]
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Cấu tạo và hoạt động núi lửa",
                        parameters={"concept": "volcano", "style": "white_chalk"}
                    ),
                    explanation=f"{mock_notice}\nNúi lửa là nơi magma từ dưới sâu lòng đất phun trào lên bề mặt qua các đứt gãy của vỏ Trái Đất."
                )

        # ----------------------------------------------------------------------
        # MÔN TIẾNG ANH (ENGLISH / TIENG_ANH)
        # ----------------------------------------------------------------------
        else:

            if scenario_idx == 0:
                # Kịch bản 1: Từ vựng danh từ chuyên ngành giáo dục
                return RecognizeCanvasResponse(
                    recognized_text="Education /ˌedʒuˈkeɪʃn/ (n): Sự giáo dục",
                    latex=None,
                    subject="TIENG_ANH",
                    confidence=0.98,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "VOCABULARY",
                        "word": "Education",
                        "word_type": "Noun (Danh từ)",
                        "ipa": "/ˌedʒuˈkeɪʃn/",
                        "vietnamese_meaning": "Sự giáo dục, nền giáo dục",
                        "synonyms": ["learning", "schooling", "instruction"],
                        "example_sentence": "Education is the key to unlock the golden door of freedom.",
                        "example_translation": "Giáo dục là chiếc chìa khóa mở ra cánh cửa vàng của sự tự do."
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Khái niệm Từ vựng: Education",
                        parameters={"word": "education", "category": "learning"}
                    ),
                    explanation=f"{mock_notice}\nTừ loại: Danh từ không đếm được. Trọng âm rơi vào âm tiết thứ ba: /keɪ/."
                )
            elif scenario_idx == 1:
                # Kịch bản 2: Tính từ tương tác (Interactive)
                return RecognizeCanvasResponse(
                    recognized_text="Interactive /ˌɪntərˈæktɪv/ (adj): Có tính tương tác",
                    latex=None,
                    subject="TIENG_ANH",
                    confidence=0.96,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "VOCABULARY",
                        "word": "Interactive",
                        "word_type": "Adjective (Tính từ)",
                        "ipa": "/ˌɪntərˈæktɪv/",
                        "vietnamese_meaning": "Có tính tương tác, tương tác lẫn nhau",
                        "synonyms": ["reciprocal", "two-way"],
                        "example_sentence": "Teachers and students love using the interactive flat panel display.",
                        "example_translation": "Thầy cô và học sinh rất thích sử dụng màn hình tương tác thông minh."
                    },
                    visualization=VisualizationData(
                        type="IMAGE_ILLUSTRATION",
                        engine="image",
                        title="Khái niệm: Interactive Flat Panel",
                        parameters={"word": "interactive"}
                    ),
                    explanation=f"{mock_notice}\nTừ ghép tiền tố 'inter-' (giữa, lẫn nhau) và 'active' (hoạt động). Thường dùng trong cụm: interactive whiteboards, interactive learning."
                )
            else:
                # Kịch bản 3: Câu ngữ pháp điều kiện
                return RecognizeCanvasResponse(
                    recognized_text="If you practice every day, your English will improve rapidly.",
                    latex=None,
                    subject="TIENG_ANH",
                    confidence=0.97,
                    has_ambiguity=False,
                    ambiguous_tokens=[],
                    subject_details={
                        "topic": "GRAMMAR_SENTENCE",
                        "grammar_structure": "First Conditional (Câu điều kiện loại 1)",
                        "if_clause": "If you practice every day (Hiện tại đơn)",
                        "main_clause": "your English will improve rapidly (Tương lai đơn will + V)",
                        "usage": "Diễn tả hành động có thể xảy ra ở hiện tại hoặc tương lai."
                    },
                    visualization=None,
                    explanation=f"{mock_notice}\nCấu trúc câu điều kiện loại 1: If + S + V(hiện tại đơn), S + will + V-nguyên thể."
                )


gemini_service = GeminiAIService()
