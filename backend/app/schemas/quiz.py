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
    session_id: str
    student_id: Optional[str] = None


class GradeMCQResponse(BaseModel):
    is_correct: bool
    selected_label: str
    correct_label: str
    explanation: str  # Why correct is correct
    distractor_analysis: Optional[str] = None  # Why student choice was wrong
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
