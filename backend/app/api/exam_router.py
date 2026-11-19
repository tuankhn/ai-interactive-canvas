import os
from typing import Optional
from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from app.schemas.quiz import (
    ExamCanvasLayoutRequest,
    ExamCanvasLayoutResponse,
    ExamParseTextRequest,
    ExamUploadResponse,
    GradeMCQRequest,
    GradeMCQResponse,
)
from app.services.exam_service import exam_service
from app.services.grading_service import grading_service

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

    result = grading_service.evaluate_mcq_choice(
        question_id=payload.question_id,
        selected_label=payload.selected_label,
        correct_label=payload.correct_label or "A",
        correct_explanation=payload.explanation or "Phương án chính xác theo định luật và số liệu bài toán.",
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


alias_router.add_api_route("/grade-mcq", grade_mcq_choice, methods=["POST"], response_model=GradeMCQResponse)
alias_router.add_api_route("/distractor-analysis", analyze_all_distractors, methods=["POST"])
