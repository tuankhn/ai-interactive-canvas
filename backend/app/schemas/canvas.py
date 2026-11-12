from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class AmbiguousToken(BaseModel):
    bbox: List[int] = Field(default_factory=lambda: [0, 0, 0, 0])  # [x, y, width, height]
    detected_text: str
    confidence: float
    suggestions: List[str]  # e.g., ["sin", "sim", "sum"]


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
    latency_ms: Optional[int] = None
    provider: Optional[str] = None
    debounce_ms: Optional[int] = 800


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
