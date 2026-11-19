from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict


class AnswerOptionCreate(BaseModel):
    label: str  # A, B, C, D
    content: str
    is_correct: bool = False
    wrong_explanation: Optional[str] = None


class AnswerOptionOut(AnswerOptionCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str


class QuestionCreate(BaseModel):
    content: str
    question_type: str = "MCQ"  # MCQ, ESSAY
    explanation: Optional[str] = None
    options: List[AnswerOptionCreate] = []


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    content: str
    question_type: str
    explanation: Optional[str]
    options: List[AnswerOptionOut] = []


class GradeMCQRequest(BaseModel):
    question_id: str
    selected_label: str  # "A", "B", "C", "D"
    session_id: Optional[str] = "default-session"
    student_id: Optional[str] = None
    question_content: Optional[str] = None
    correct_label: Optional[str] = None
    explanation: Optional[str] = None
    distractor_map: Optional[Dict[str, str]] = None
    subject: Optional[str] = "TOAN"


class GradeMCQResponse(BaseModel):
    is_correct: bool
    selected_label: str
    correct_label: str
    status: str = "CORRECT"  # "CORRECT" hoặc "INCORRECT"
    explanation: str  # Giải thích tại sao đáp án đúng là đúng
    distractor_analysis: Optional[str] = None  # Chỉ rõ lý do sai của phương án đã chọn
    guidance: Optional[str] = None  # Hướng dẫn từng bước cách tìm ra đáp án đúng
    error_category: Optional[str] = None  # Nhóm lỗi (CONCEPTUAL, CALCULATION, SIGN, ...)
    badge_color: str = "#16a34a"  # "#16a34a" (tích xanh) hoặc "#dc2626" (cảnh báo đỏ)
    icon: str = "✓"  # "✓" hoặc "✕"
    suggested_bonus_points: float = 1.0


class GradeEssayStepRequest(BaseModel):
    question_id: str
    session_id: str
    step_number: int
    written_text: str  # Current step written by student
    previous_steps: List[str] = []


class GradeEssayStepResponse(BaseModel):
    step_number: int
    is_step_correct: bool
    feedback: str
    has_math_error: bool = False
    guidance: Optional[str] = None


# -------------------------------------------------------------
# Schemas cho Task TF28517: Tải đề DOCX/PDF & Ẩn đáp án học sinh
# -------------------------------------------------------------

class AnswerOptionItem(BaseModel):
    label: str
    content: str
    is_correct: bool = False
    wrong_explanation: Optional[str] = None


class QuestionItem(BaseModel):
    id: str
    number: int
    content: str
    question_type: str = "MCQ"  # MCQ hoặc ESSAY
    correct_option: Optional[str] = None
    explanation: Optional[str] = None
    options: List[AnswerOptionItem] = []


class ExamParseTextRequest(BaseModel):
    raw_text: str
    title: Optional[str] = "Đề bài trực tiếp"
    mode: Optional[str] = "STUDENT"  # "STUDENT" hoặc "TEACHER"
    subject: Optional[str] = "TOAN"


class ExamUploadResponse(BaseModel):
    title: str
    mode: str
    total_questions: int
    questions: List[QuestionItem]
    source_type: str  # TEXT, DOCX, PDF
    hidden_answers: bool = True


class ExamCanvasLayoutRequest(BaseModel):
    questions: List[Dict[str, Any]]
    mode: Optional[str] = "STUDENT"
    questions_per_page: Optional[int] = 2


class ExamCanvasLayoutResponse(BaseModel):
    mode: str
    total_pages: int
    pages: List[Dict[str, Any]]


# -------------------------------------------------------------
# Schemas cho Task TF28518: Nhận diện vùng tọa độ nét khoanh đáp án
# -------------------------------------------------------------

class StrokeBoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class QuizOptionRegion(BaseModel):
    label: str  # "A", "B", "C", "D"
    x: float
    y: float
    width: float
    height: float


class CircleAnswerSubmitRequest(BaseModel):
    question_id: str
    session_id: Optional[str] = "default-session"
    room_id: Optional[str] = "room-10a1"
    student_id: Optional[str] = None
    stroke_bbox: StrokeBoundingBox
    option_regions: List[QuizOptionRegion] = []
    selected_label: Optional[str] = None
    stroke_points_count: int = 0
    circularity_score: Optional[float] = None
    selection_method: str = "CIRCLE_GESTURE"
    question_content: Optional[str] = None
    correct_label: Optional[str] = None
    explanation: Optional[str] = None
    distractor_map: Optional[Dict[str, str]] = None
    subject: Optional[str] = "TOAN"


class CircleAnswerSubmitResponse(BaseModel):
    submission_id: str
    matched_label: str
    overlap_score: float
    selection_method: str
    stroke_bbox: StrokeBoundingBox
    grade_result: GradeMCQResponse


# -------------------------------------------------------------
# Schemas cho Task TF2851B: AI Tạo câu hỏi tương tự & Nâng cao
# -------------------------------------------------------------

class QuestionVariantType(str, Enum):
    SIMILAR = "SIMILAR"       # Bài tương tự - Đổi số liệu
    ADVANCED = "ADVANCED"     # Bài nâng cao - Thêm điều kiện độ khó
    BOTH = "BOTH"             # Sinh cả hai biến thể


class GeneratedVariantItem(BaseModel):
    id: str
    variant_type: str  # "SIMILAR" hoặc "ADVANCED"
    type_display: str  # "Bài tập tương tự (Đổi số liệu)" hoặc "Bài tập nâng cao (Thêm điều kiện độ khó)"
    badge_color: str   # "#16a34a" (xanh lá) hoặc "#7c3aed" (tím)
    icon: str          # "🔄" hoặc "🚀"
    title: str
    question_content: str
    original_question: str
    difficulty_level: str  # "Nhận biết", "Thông hiểu", "Vận dụng", "Vận dụng cao"
    changed_parameters: Optional[str] = None  # Mô tả thông số/số liệu đã đổi
    added_conditions: Optional[str] = None    # Mô tả điều kiện nâng cao đã thêm
    advanced_hint: Optional[str] = None       # Gợi ý phương pháp cho học sinh khá giỏi
    correct_answer: str                       # Đáp số / kết quả mới
    solution_guide: str                       # Hướng dẫn giải chi tiết
    canvas_card_text: str                     # Chuỗi text format để chèn lên bảng vẽ


class GenerateQuestionVariantRequest(BaseModel):
    original_question: str
    variant_type: Optional[str] = "SIMILAR"  # "SIMILAR", "ADVANCED", "BOTH"
    subject: Optional[str] = "TOAN"          # "TOAN", "VAT_LY", "HOA_HOC", ...
    current_difficulty: Optional[str] = "THONG_HIEU"
    topic: Optional[str] = None
    seed: Optional[int] = None               # Seed số ngẫu nhiên nếu muốn đổi sang biến thể khác
    include_solution: bool = True


class GenerateQuestionVariantResponse(BaseModel):
    original_question: str
    subject: str
    requested_type: str
    total_variants: int
    variants: List[GeneratedVariantItem]
    generation_source: str                   # "MATH_PERTURBATION_ENGINE" hoặc "AI_GEMINI"
    timestamp: str
