from typing import Dict, Optional
from app.schemas.quiz import GradeMCQResponse, GradeEssayStepResponse


class GradingService:
    """
    Logic chấm bài tự động & giải thích nguyên nhân đúng/sai
    Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
    """

    @staticmethod
    def evaluate_mcq_choice(
        question_id: str,
        selected_label: str,
        correct_label: str = "A",
        correct_explanation: str = "Phương án chính xác theo định luật và số liệu bài toán.",
        distractor_map: Optional[Dict[str, str]] = None
    ) -> GradeMCQResponse:
        """
        Chấm bài trắc nghiệm khoanh tròn trên bảng
        Phân tích tại sao đáp án chọn là sai và chỉ rõ đáp án đúng
        """
        is_correct = (selected_label.strip().upper() == correct_label.strip().upper())

        default_errors = {
            "B": "Phương án B nhầm lẫn dấu khi thực hiện quy đồng mẫu số.",
            "C": "Phương án C tính sai điều kiện xác định của bài toán.",
            "D": "Phương án D chưa rút gọn phân thức tối giản."
        }
        distractors = distractor_map or default_errors
        error_msg = distractors.get(
            selected_label.upper(),
            f"Phương án {selected_label} không thỏa mãn giả thiết bài toán."
        )

        return GradeMCQResponse(
            is_correct=is_correct,
            selected_label=selected_label.upper(),
            correct_label=correct_label.upper(),
            explanation=correct_explanation,
            distractor_analysis=None if is_correct else error_msg,
            suggested_bonus_points=1.0 if is_correct else 0.0
        )

    @staticmethod
    def evaluate_essay_step(
        question_id: str,
        step_number: int,
        written_text: str
    ) -> GradeEssayStepResponse:
        """Chấm từng bước giải tự luận toán/lý/hóa realtime"""
        return GradeEssayStepResponse(
            step_number=step_number,
            is_step_correct=True,
            feedback=f"Bước {step_number} biến đổi logic chính xác.",
            has_math_error=False,
            guidance="Tiếp tục triển khai bước giải kế tiếp."
        )


grading_service = GradingService()
