from datetime import datetime, timezone
import math
import os
from typing import List, Optional, Tuple
import uuid
from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from app.core.database import in_memory_circle_submissions, in_memory_exam_answer_keys
from app.schemas.quiz import (
    CircleAnswerSubmitRequest,
    CircleAnswerSubmitResponse,
    ExamCanvasLayoutRequest,
    ExamCanvasLayoutResponse,
    ExamParseTextRequest,
    ExamUploadResponse,
    GeneratedVariantItem,
    GenerateQuestionVariantRequest,
    GenerateQuestionVariantResponse,
    GradeMCQRequest,
    GradeMCQResponse,
    GradeEssayStepRequest,
    GradeEssayStepResponse,
    GradeEssaySolutionRequest,
    GradeEssaySolutionResponse,
    QuizOptionRegion,
    StrokeBoundingBox,
)
from app.services.exam_service import exam_service
from app.services.grading_service import grading_service
from app.services.question_generator_service import question_variant_service

router = APIRouter(prefix="/api/v1/exam", tags=["Exam / Quiz Management"])
alias_router = APIRouter(prefix="/api/v1/quiz", tags=["Exam / Quiz Management Alias"])


@router.post(
    "/upload",
    response_model=ExamUploadResponse,
    summary="Tải file đề thi (.docx, .pdf, .txt) và bóc tách câu hỏi",
    description="Hỗ trợ giáo viên tải file đề thi DOCX hoặc PDF. Tự động nhận diện câu hỏi, đáp án đúng và ẩn đáp án khi ở chế độ Học sinh.",
)
async def upload_exam_file(
    file: UploadFile = File(...),
    mode: str = Query("STUDENT", description="Chế độ xem: 'STUDENT' (ẩn đáp án) hoặc 'TEACHER' (hiện đáp án đầy đủ)"),
    title: Optional[str] = Query(None, description="Tiêu đề bài thi tùy chỉnh"),
):
    filename = file.filename or "de_thi"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in [".docx", ".pdf", ".txt"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Định dạng tệp '{ext}' không được hỗ trợ. Vui lòng tải file .docx, .pdf hoặc .txt.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tệp rỗng, vui lòng kiểm tra lại nội dung.",
        )

    exam_title = title or os.path.splitext(filename)[0]

    if ext == ".docx":
        raw_parsed = exam_service.parse_docx(file_bytes, filename=exam_title)
    elif ext == ".pdf":
        raw_parsed = exam_service.parse_pdf(file_bytes, filename=exam_title)
    else:
        text_content = file_bytes.decode("utf-8", errors="ignore")
        raw_parsed = exam_service.parse_text(text_content, title=exam_title)

    filtered_result = exam_service.filter_by_mode(raw_parsed, mode=mode)
    return filtered_result


@router.post(
    "/parse-text",
    response_model=ExamUploadResponse,
    summary="Bóc tách câu hỏi từ văn bản giáo viên nhập trực tiếp",
    description="Cho phép giáo viên gõ hoặc dán nội dung đề thi trực tiếp. Tự động nhận diện MCQ/Tự luận và ẩn đáp án đúng trong chế độ Học sinh.",
)
async def parse_direct_text(payload: ExamParseTextRequest):
    if not payload.raw_text or not payload.raw_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nội dung đề bài không được để trống.",
        )

    raw_parsed = exam_service.parse_text(payload.raw_text, title=payload.title or "Đề bài trực tiếp")
    filtered_result = exam_service.filter_by_mode(raw_parsed, mode=payload.mode or "STUDENT")
    return filtered_result


@router.post(
    "/layout-canvas",
    response_model=ExamCanvasLayoutResponse,
    summary="Chuyển đổi danh sách câu hỏi thành đối tượng vẽ Fabric.js dàn lên mặt bảng",
    description="Tạo cấu trúc JSON Fabric.js tương thích với bảng vẽ, phân bổ câu hỏi theo trang (2 câu/trang).",
)
async def layout_questions_on_canvas(payload: ExamCanvasLayoutRequest):
    questions = payload.questions
    mode = payload.mode or "STUDENT"
    per_page = payload.questions_per_page or 2

    canvas_layout = exam_service.generate_canvas_layout(
        questions=questions,
        mode=mode,
        questions_per_page=per_page,
    )
    return canvas_layout


@router.get(
    "/sample",
    response_model=ExamUploadResponse,
    summary="Lấy đề thi mẫu thử nghiệm nhanh theo môn học",
    description="Cung cấp sẵn đề mẫu môn Toán, Vật lý, Tiếng Anh để giáo viên thử nghiệm dàn câu hỏi lên bảng vẽ.",
)
async def get_sample_exam(
    subject: str = Query("TOAN", description="Môn học: TOAN, VAT_LY, TIENG_ANH"),
    mode: str = Query("STUDENT", description="Chế độ xem: 'STUDENT' hoặc 'TEACHER'"),
):
    sample_text = exam_service.get_sample_exam(subject)
    raw_parsed = exam_service.parse_text(sample_text, title=f"Đề mẫu môn {subject}")
    filtered_result = exam_service.filter_by_mode(raw_parsed, mode=mode)
    return filtered_result


@router.post(
    "/grade-mcq",
    response_model=GradeMCQResponse,
    summary="Chấm trắc nghiệm và giải thích phương án gây nhiễu (Task TF28519)",
    description="Kiểm tra đáp án học sinh khoanh: Đúng hiện tích xanh (#16a34a) và giải thích; Sai hiện cảnh báo đỏ (#dc2626), chỉ rõ lý do sai của phương án đã chọn và hướng dẫn cách tìm ra đáp án đúng.",
)
async def grade_mcq_choice(payload: GradeMCQRequest):
    if not payload.selected_label or not payload.selected_label.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vui lòng chọn hoặc khoanh tròn một phương án (A, B, C hoặc D).",
        )

    stored_key = in_memory_exam_answer_keys.get(payload.question_id, {})
    resolved_correct = payload.correct_label or stored_key.get("correct_option") or "A"
    resolved_explanation = (
        payload.explanation
        or stored_key.get("explanation")
        or "Phương án chính xác theo định luật và số liệu bài toán."
    )

    result = grading_service.evaluate_mcq_choice(
        question_id=payload.question_id,
        selected_label=payload.selected_label,
        correct_label=resolved_correct,
        correct_explanation=resolved_explanation,
        distractor_map=payload.distractor_map,
        question_content=payload.question_content,
        subject=payload.subject or "TOAN",
        session_id=payload.session_id,
        student_id=payload.student_id,
    )
    return result


@router.post(
    "/distractor-analysis",
    summary="Phân tích toàn diện tất cả các phương án gây nhiễu của câu hỏi",
    description="Hỗ trợ giáo viên xem trước lý do sai tiềm ẩn của học sinh cho từng phương án lựa chọn.",
)
async def analyze_all_distractors(
    correct_label: str = Query("A", description="Đáp án đúng (A, B, C, D)"),
    subject: str = Query("TOAN", description="Môn học"),
    question_content: Optional[str] = Query(None, description="Nội dung câu hỏi"),
):
    labels = ["A", "B", "C", "D"]
    corr = correct_label.strip().upper()
    analysis_results = {}

    for lbl in labels:
        if lbl == corr:
            analysis_results[lbl] = {
                "is_correct": True,
                "badge": "✓ ĐÁP ÁN ĐÚNG",
                "color": "#16a34a",
                "explanation": "Phương án chính xác theo định luật bài toán.",
            }
        else:
            res = grading_service.analyze_distractor(
                selected_label=lbl,
                correct_label=corr,
                subject=subject,
                question_content=question_content,
            )
            analysis_results[lbl] = {
                "is_correct": False,
                "badge": "✕ PHƯƠNG ÁN GÂY NHIỄU",
                "color": "#dc2626",
                "reason": res.get("reason"),
                "guidance": res.get("guidance"),
                "category": res.get("category"),
            }

    return {
        "subject": subject,
        "correct_label": corr,
        "distractors": analysis_results,
    }


def _match_stroke_to_option(
    stroke: StrokeBoundingBox,
    option_regions: List[QuizOptionRegion],
    fallback_label: Optional[str] = None,
) -> Tuple[Optional[str], float]:
    """Đối chiếu vùng tọa độ nét khoanh tròn với danh sách tọa độ các phương án A/B/C/D."""
    if not option_regions:
        cleaned = (fallback_label or "").strip().upper()
        return (cleaned or None), (1.0 if cleaned else 0.0)

    sx1, sy1 = stroke.x, stroke.y
    sx2, sy2 = stroke.x + max(1.0, stroke.width), stroke.y + max(1.0, stroke.height)
    scx, scy = (sx1 + sx2) / 2.0, (sy1 + sy2) / 2.0
    stroke_area = max(1.0, (sx2 - sx1) * (sy2 - sy1))

    best_label: Optional[str] = None
    best_score: float = -1.0
    nearest_label: Optional[str] = None
    nearest_dist: float = float("inf")

    for region in option_regions:
        rx1, ry1 = region.x, region.y
        rx2, ry2 = region.x + max(1.0, region.width), region.y + max(1.0, region.height)
        region_area = max(1.0, (rx2 - rx1) * (ry2 - ry1))

        ix1, iy1 = max(sx1, rx1), max(sy1, ry1)
        ix2, iy2 = min(sx2, rx2), min(sy2, ry2)
        inter_w = max(0.0, ix2 - ix1)
        inter_h = max(0.0, iy2 - iy1)
        inter_area = inter_w * inter_h

        containment = inter_area / stroke_area
        union_area = max(1.0, stroke_area + region_area - inter_area)
        iou = inter_area / union_area

        # Trọng số ưu tiên tâm nét khoanh nằm trong dải tọa độ dọc của phương án
        y_center_inside = 1.0 if (ry1 - 8.0 <= scy <= ry2 + 8.0) else 0.0
        x_overlap = 1.0 if (sx2 >= rx1 - 16.0 and sx1 <= rx2 + 16.0) else 0.0
        score = (0.65 * containment) + (0.20 * iou) + (0.15 * y_center_inside * x_overlap)

        if score > best_score:
            best_score = score
            best_label = region.label.strip().upper()

        rcy = (ry1 + ry2) / 2.0
        badge_cx = rx1 + min(30.0, (rx2 - rx1) / 2.0)
        dist = math.hypot(scx - badge_cx, scy - rcy)
        if dist < nearest_dist:
            nearest_dist = dist
            nearest_label = region.label.strip().upper()

    if best_score > 0.05 and best_label:
        return best_label, round(min(1.0, best_score), 3)

    if nearest_label and nearest_dist <= 45.0:
        return nearest_label, round(max(0.15, 1.0 - nearest_dist / 60.0), 3)

    if fallback_label:
        return fallback_label.strip().upper(), 0.5

    return None, 0.0


@router.post(
    "/circle-answer",
    response_model=CircleAnswerSubmitResponse,
    summary="TF28518: Nhận vùng tọa độ nét khoanh tròn đáp án A/B/C/D từ bảng và chấm bài",
    description="Tiếp nhận tọa độ nét khoanh của học sinh, đối chiếu với vị trí các phương án trên Canvas, lưu log vùng khoanh và trả kết quả chấm bài.",
)
async def submit_circled_answer(payload: CircleAnswerSubmitRequest):
    matched_label, overlap_score = _match_stroke_to_option(
        stroke=payload.stroke_bbox,
        option_regions=payload.option_regions,
        fallback_label=payload.selected_label,
    )
    if not matched_label:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vùng tọa độ nét khoanh chưa khớp với phương án A, B, C hoặc D nào.",
        )

    stored_key = in_memory_exam_answer_keys.get(payload.question_id, {})
    resolved_correct = payload.correct_label or stored_key.get("correct_option") or "A"
    resolved_explanation = (
        payload.explanation
        or stored_key.get("explanation")
        or "Phương án chính xác theo định luật và số liệu bài toán."
    )

    grade_result = grading_service.evaluate_mcq_choice(
        question_id=payload.question_id,
        selected_label=matched_label,
        correct_label=resolved_correct,
        correct_explanation=resolved_explanation,
        distractor_map=payload.distractor_map,
        question_content=payload.question_content,
        subject=payload.subject or "TOAN",
        session_id=payload.session_id,
        student_id=payload.student_id,
    )

    submission_id = f"circle_{uuid.uuid4().hex[:12]}"
    in_memory_circle_submissions.insert(
        0,
        {
            "submission_id": submission_id,
            "question_id": payload.question_id,
            "session_id": payload.session_id,
            "room_id": payload.room_id,
            "student_id": payload.student_id,
            "matched_label": matched_label,
            "overlap_score": overlap_score,
            "selection_method": payload.selection_method,
            "stroke_points_count": payload.stroke_points_count,
            "circularity_score": payload.circularity_score,
            "stroke_bbox": payload.stroke_bbox.model_dump(),
            "is_correct": grade_result.is_correct,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    return CircleAnswerSubmitResponse(
        submission_id=submission_id,
        matched_label=matched_label,
        overlap_score=overlap_score,
        selection_method=payload.selection_method,
        stroke_bbox=payload.stroke_bbox,
        grade_result=grade_result,
    )


@router.get(
    "/circle-submissions",
    summary="TF28518: Danh sách các lượt khoanh đáp án trắc nghiệm đã gửi về Backend",
)
async def list_circle_submissions(
    session_id: Optional[str] = Query(default=None),
    question_id: Optional[str] = Query(default=None),
    room_id: Optional[str] = Query(default=None),
):
    sess_str = session_id if isinstance(session_id, str) else None
    q_str = question_id if isinstance(question_id, str) else None
    room_str = room_id if isinstance(room_id, str) else None
    items = [
        item
        for item in in_memory_circle_submissions
        if (not sess_str or item.get("session_id") == sess_str)
        and (not q_str or item.get("question_id") == q_str)
        and (not room_str or item.get("room_id") == room_str)
    ]
    return {"count": len(items), "items": items}


# =========================================================================
# TASK TF2851A: CHẤM BÀI GIẢI TỰ LUẬN THEO TỪNG DÒNG VIẾT TAY
# =========================================================================

@router.post(
    "/grade-essay-step",
    response_model=GradeEssayStepResponse,
    summary="TF2851A: Chấm một bước/dòng giải tự luận viết tay realtime",
    description="Kiểm tra dòng viết tay học sinh vừa viết: Đúng đánh dấu tích xanh; Sai gạch chân đỏ ngay dòng tính sai hoặc nhầm công thức và hiện gợi ý sửa mà không lộ đáp án cuối.",
)
async def grade_essay_single_step(payload: GradeEssayStepRequest):
    if not payload.written_text or not payload.written_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nội dung bước giải tự luận không được để trống.",
        )

    res = grading_service.evaluate_essay_step(
        question_id=payload.question_id,
        step_number=payload.step_number,
        written_text=payload.written_text,
        previous_steps=payload.previous_steps,
        question_content=payload.question_content,
        subject=payload.subject or "TOAN",
        target_answer=payload.target_answer,
        line_bounding_box=payload.line_bounding_box,
    )
    return res


@router.post(
    "/grade-essay-solution",
    response_model=GradeEssaySolutionResponse,
    summary="TF2851A: Chấm toàn bộ bài giải tự luận gồm nhiều dòng viết tay",
    description="Duyệt từng bước giải, đánh dấu tích xanh các bước biến đổi đúng, gạch chân đỏ các dòng sai và tổng hợp phản hồi không lộ đáp án.",
)
async def grade_essay_full_solution(payload: GradeEssaySolutionRequest):
    if not payload.steps and not payload.raw_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vui lòng cung cấp danh sách các bước hoặc văn bản lời giải để chấm.",
        )

    res = grading_service.evaluate_essay_solution(
        question_id=payload.question_id,
        steps=payload.steps,
        raw_text=payload.raw_text,
        question_content=payload.question_content,
        subject=payload.subject or "TOAN",
        target_answer=payload.target_answer,
    )
    return res


# -------------------------------------------------------------
# Endpoints cho Task TF2851B: AI Tạo câu hỏi tương tự & Nâng cao
# -------------------------------------------------------------

@router.post(
    "/generate-variant",
    response_model=GenerateQuestionVariantResponse,
    summary="TF2851B: AI tạo câu hỏi tương tự (đổi số liệu) và câu hỏi nâng cao (thêm điều kiện độ khó)",
    description="Từ bài tập đang chiếu trên bảng, giáo viên bấm nút để AI đổi số liệu tạo bài tương tự hoặc thêm điều kiện nâng cao độ khó cho học sinh khá giỏi.",
)
async def generate_question_variant(payload: GenerateQuestionVariantRequest):
    if not payload.original_question or not payload.original_question.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nội dung đề bài gốc không được để trống.",
        )
    return await question_variant_service.generate_variants(payload)


@router.post(
    "/generate-similar-question",
    response_model=GenerateQuestionVariantResponse,
    summary="TF2851B: AI tạo bài tập tương tự bằng cách đổi số liệu hợp lý",
)
async def generate_similar_question(payload: GenerateQuestionVariantRequest):
    payload.variant_type = "SIMILAR"
    if not payload.original_question or not payload.original_question.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nội dung đề bài gốc không được để trống.",
        )
    return await question_variant_service.generate_variants(payload)


@router.post(
    "/generate-advanced-question",
    response_model=GenerateQuestionVariantResponse,
    summary="TF2851B: AI tạo bài tập nâng cao bằng cách thêm điều kiện độ khó cho học sinh khá giỏi",
)
async def generate_advanced_question(payload: GenerateQuestionVariantRequest):
    payload.variant_type = "ADVANCED"
    if not payload.original_question or not payload.original_question.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nội dung đề bài gốc không được để trống.",
        )
    return await question_variant_service.generate_variants(payload)


alias_router.add_api_route("/grade-mcq", grade_mcq_choice, methods=["POST"], response_model=GradeMCQResponse)
alias_router.add_api_route("/distractor-analysis", analyze_all_distractors, methods=["POST"])
alias_router.add_api_route(
    "/circle-answer",
    submit_circled_answer,
    methods=["POST"],
    response_model=CircleAnswerSubmitResponse,
)
alias_router.add_api_route("/circle-submissions", list_circle_submissions, methods=["GET"])
alias_router.add_api_route("/grade-essay-step", grade_essay_single_step, methods=["POST"], response_model=GradeEssayStepResponse)
alias_router.add_api_route("/grade-essay-solution", grade_essay_full_solution, methods=["POST"], response_model=GradeEssaySolutionResponse)
alias_router.add_api_route("/generate-variant", generate_question_variant, methods=["POST"], response_model=GenerateQuestionVariantResponse)
alias_router.add_api_route("/generate-similar-question", generate_similar_question, methods=["POST"], response_model=GenerateQuestionVariantResponse)
alias_router.add_api_route("/generate-advanced-question", generate_advanced_question, methods=["POST"], response_model=GenerateQuestionVariantResponse)
