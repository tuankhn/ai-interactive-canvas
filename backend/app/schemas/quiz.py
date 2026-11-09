from typing import List, Optional
from pydantic import BaseModel


class AnswerOptionCreate(BaseModel):
    label: str  # A, B, C, D
    content: str
    is_correct: bool = False
    wrong_explanation: Optional[str] = None


class AnswerOptionOut(AnswerOptionCreate):
    id: str

    class Config:
        from_attributes = True


class QuestionCreate(BaseModel):
    content: str
    question_type: str = "MCQ"  # MCQ, ESSAY
    explanation: Optional[str] = None
    options: List[AnswerOptionCreate] = []


class QuestionOut(BaseModel):
    id: str
    content: str
    question_type: str
    explanation: Optional[str]
    options: List[AnswerOptionOut] = []

    class Config:
        from_attributes = True


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
