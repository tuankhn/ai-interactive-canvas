from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    x: int = Field(0, description="Tọa độ X góc trên bên trái vùng có nét viết")
    y: int = Field(0, description="Tọa độ Y góc trên bên trái vùng có nét viết")
    width: int = Field(0, description="Chiều rộng vùng cắt")
    height: int = Field(0, description="Chiều cao vùng cắt")


class RecognizeRequest(BaseModel):
    session_id: str = Field(default="session-10a1-toan", description="ID phiên học")
    room_id: str = Field(default="room-10a1", description="Mã phòng học độc lập")
    subject: str = Field(default="TOAN", description="Môn học: TOAN, VAT_LY, HOA_HOC, TIENG_ANH")
    page_number: int = Field(default=1, ge=1)
    image_base64: str = Field(..., description="Chuỗi ảnh vùng vẽ Canvas dạng Base64 (PNG/WebP)")
    stroke_hint: Optional[str] = Field(default=None, description="Gợi ý văn bản/biểu thức nếu có")


class PreprocessInfo(BaseModel):
    original_size: List[int]
    cropped_size: List[int]
    bounding_box: BoundingBox
    processed_base64: str
    size_reduction_percent: float


class RecognizeResponse(BaseModel):
    session_id: str
    room_id: str
    page_number: int
    subject: str
    provider: str
    recognized_text: str
    latex: str
    confidence: float
    needs_correction: bool
    suggestions: List[str]
    latency_ms: int
    preprocess: PreprocessInfo


class PageSaveRequest(BaseModel):
    session_id: str
    room_id: str
    page_number: int = Field(..., ge=1)
    canvas_json: Dict[str, Any] = Field(default_factory=dict)
    recognized_latex: Optional[str] = None


class SnapshotSaveRequest(BaseModel):
    session_id: str
    room_id: str
    class_name: str = "10A1"
    teacher_name: str = "Nguyễn Tuấn Khang"
    subject: str = "TOAN"
    period_number: int = 1
    page_number: int = 1
    trigger_type: str = "BEFORE_CLEAR"
    image_base64: str
    recognized_latex: Optional[str] = None
