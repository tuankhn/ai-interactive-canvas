import json
import logging
from typing import Optional
from app.core.config import settings
from app.schemas.canvas import RecognizeCanvasResponse, AmbiguousToken, VisualizationData
from app.ai.prompts import SYSTEM_PROMPT_TEMPLATE

logger = logging.getLogger(__name__)


class GeminiAIService:
    """
    Module kết nối Gemini 2.5 Flash đa phương thức
    Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
    """
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self.is_configured = False
        self._init_model()

    def _init_model(self):
        if self.api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                self.model = genai.GenerativeModel("gemini-2.5-flash")
                self.is_configured = True
            except Exception as e:
                logger.warning(f"Chưa thể kết nối Gemini API: {e}")
                self.is_configured = False

    async def analyze_board(
        self,
        image_base64: str,
        subject: str = "MATH",
        grade_level: Optional[str] = None
    ) -> RecognizeCanvasResponse:
        """Phân tích ảnh bảng vẽ bằng Gemini 2.5 Flash"""
        if not self.is_configured:
            return self._mock_result(subject)

        try:
            import google.generativeai as genai
            import base64
            from io import BytesIO
            from PIL import Image

            if "," in image_base64:
                _, image_base64 = image_base64.split(",", 1)
            raw_bytes = base64.b64decode(image_base64)
            pil_image = Image.open(BytesIO(raw_bytes))

            prompt = SYSTEM_PROMPT_TEMPLATE.format(
                subject=subject,
                grade_level=grade_level or "THPT"
            )

            response = self.model.generate_content([prompt, pil_image])
            raw_text = response.text.strip()

            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]

            parsed_data = json.loads(raw_text.strip())
            return RecognizeCanvasResponse(**parsed_data)

        except Exception as err:
            logger.error(f"Lỗi phân tích Gemini Vision: {err}")
            return self._mock_result(subject)

    def _mock_result(self, subject: str) -> RecognizeCanvasResponse:
        """Dữ liệu mẫu phản hồi tức thì cho môi trường kiểm thử local"""
        if subject.upper() == "MATH":
            return RecognizeCanvasResponse(
                recognized_text="y = x^2 - 4x + 3",
                latex="y = x^2 - 4x + 3",
                subject="MATH",
                confidence=0.96,
                has_ambiguity=False,
                ambiguous_tokens=[],
                visualization=VisualizationData(
                    type="2D_GRAPH",
                    engine="plotly",
                    title="Đồ thị Parabol y = x^2 - 4x + 3",
                    parameters={
                        "function": "x**2 - 4*x + 3",
                        "x_range": [-2, 6],
                        "vertex": [2, -1],
                        "roots": [1, 3]
                    },
                    latex_formula="y = x^2 - 4x + 3"
                ),
                explanation="Parabol có đỉnh I(2, -1), trục đối xứng x = 2, cắt trục tung tại (0, 3)."
            )
        elif subject.upper() == "PHYS":
            return RecognizeCanvasResponse(
                recognized_text="F = m * a",
                latex="F = m \\cdot a",
                subject="PHYS",
                confidence=0.95,
                has_ambiguity=False,
                ambiguous_tokens=[],
                visualization=VisualizationData(
                    type="2D_GRAPH",
                    engine="plotly",
                    title="Định luật II Newton: F = ma",
                    parameters={"slope": 2.0},
                    latex_formula="F = m \\cdot a"
                ),
                explanation="Gia tốc của một vật có cùng hướng với lực tác dụng và tỉ lệ thuận với độ lớn của lực."
            )
        else:
            return RecognizeCanvasResponse(
                recognized_text="Photosynthesis",
                latex=None,
                subject=subject,
                confidence=0.92,
                has_ambiguity=False,
                ambiguous_tokens=[],
                visualization=VisualizationData(
                    type="IMAGE_ILLUSTRATION",
                    engine="image",
                    title="Quá trình Quang Hợp",
                    parameters={"concept": "Photosynthesis", "style": "chalkboard"}
                ),
                explanation="Quá trình cây xanh sử dụng ánh sáng mặt trời để tổng hợp chất hữu cơ từ CO2 và nước."
            )


gemini_service = GeminiAIService()
