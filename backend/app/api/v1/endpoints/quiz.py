from fastapi import APIRouter
from app.schemas.quiz import (
    GradeMCQRequest,
    GradeMCQResponse,
    GradeEssayStepRequest,
    GradeEssayStepResponse,
)
from app.services import grading_service

router = APIRouter()


@router.post("/grade-mcq", response_model=GradeMCQResponse, summary="Chấm bài trắc nghiệm khoanh tròn trên bảng")
async def grade_mcq(payload: GradeMCQRequest):
    return grading_service.evaluate_mcq_choice(
        question_id=payload.question_id,
        selected_label=payload.selected_label,
        correct_label="A",
        correct_explanation="Phương án A chính xác theo định lý và số liệu bài toán.",
    )


@router.post("/grade-essay-step", response_model=GradeEssayStepResponse, summary="Chấm từng bước tự luận realtime")
async def grade_essay_step(payload: GradeEssayStepRequest):
    return grading_service.evaluate_essay_step(
        question_id=payload.question_id,
        step_number=payload.step_number,
        written_text=payload.written_text
    )
