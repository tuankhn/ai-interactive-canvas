from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class AmbiguousToken(BaseModel):
    bbox: List[int] = Field(default_factory=lambda: [0, 0, 0, 0])  # [x, y, width, height]
    detected_text: str = Field(default="")
    confidence: float = Field(default=0.8)
    suggestions: List[str] = Field(default_factory=list)  # e.g., ["sin", "sim", "sum"]


class VisualizationData(BaseModel):
    type: str  # "2D_GRAPH", "3D_GEOMETRY", "3D_MOLECULE", "IMAGE_ILLUSTRATION"
    engine: str  # "plotly", "threejs", "3dmol", "image"
    title: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    latex_formula: Optional[str] = None
    image_url: Optional[str] = None


class RecognizeCanvasRequest(BaseModel):
    image_base64: str  # Data URL or base64 encoded PNG of canvas
    subject: str = "MATH"  # MATH, PHYS, CHEM, ENG, BIO
    grade_level: Optional[str] = None
    session_id: Optional[str] = None
    debounce_ms: int = 800  # Debounce thời gian dừng bút
    provider: str = "auto"  # auto, gemini, mathpix


class RecognizeCanvasResponse(BaseModel):
    recognized_text: str
    latex: Optional[str] = None
    subject: str
    confidence: float
    has_ambiguity: bool = False
    ambiguous_tokens: List[AmbiguousToken] = Field(default_factory=list)
    visualization: Optional[VisualizationData] = None
    explanation: Optional[str] = None
    subject_details: Optional[Dict[str, Any]] = None
    illustration: Optional[ChalkIllustrationData] = None
    latency_ms: Optional[int] = None
    provider: Optional[str] = None
    debounce_ms: Optional[int] = 800


class ChalkIllustrationData(BaseModel):
    concept: str
    subject: str = "TIENG_ANH"
    illustration_type: str = "CHALK_SVG"
    svg_content: str
    image_data_url: str
    caption: str
    suggested_position: Dict[str, int] = Field(default_factory=lambda: {"x": 300, "y": 60, "width": 220, "height": 220})
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)


class IllustrationRequest(BaseModel):
    concept: str = Field(..., description="Từ vựng tiếng Anh hoặc khái niệm Sinh, Địa cần minh họa")
    subject: str = Field(default="TIENG_ANH", description="Môn học: TIENG_ANH, SINH_HOC, DIA_LY")
    style: str = Field(default="white_chalk", description="Phong cách nét vẽ: white_chalk")
    target_bbox: Optional[List[int]] = Field(default=None, description="Tọa độ vùng chữ viết [x, y, w, h] trên bảng")


class IllustrationResponse(BaseModel):
    concept: str
    subject: str
    illustration_type: str = "CHALK_SVG"
    svg_content: str
    image_data_url: str
    caption: str
    suggested_position: Dict[str, int]
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)


class CorrectTokenRequest(BaseModel):
    session_id: str
    original_text: str
    corrected_text: str
    context_latex: Optional[str] = None


class PreprocessCanvasRequest(BaseModel):
    image_base64: str
    padding: int = 25
    max_dim: int = 1280
    output_format: str = "WEBP"


class PreprocessCanvasResponse(BaseModel):
    processed_base64: str
    has_strokes: bool
    bounding_box: List[int]  # [x, y, width, height]
    original_dimensions: List[int]
    processed_dimensions: List[int]
    original_size_kb: float
    processed_size_kb: float
    compression_ratio_percent: float

