from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from app.core.database import (
    in_memory_classes,
    in_memory_schools,
    in_memory_score_logs,
    in_memory_snapshots,
    in_memory_users,
)
from app.core.demo_seed import (
    DEMO_SUBJECTS_METADATA,
    get_demo_accounts_directory,
    load_demo_exam_raw_text,
    seed_demo_environment,
)
from app.services.exam_service import exam_service

router = APIRouter(
    prefix="/api/v1/demo",
    tags=["Docker & Demo Presentation Seed Data (TF28524)"],
)


@router.get("/overview", summary="TF28524: Tổng quan dữ liệu mẫu Demo phục vụ buổi báo cáo")
async def get_demo_overview():
    seed_demo_environment(force=False)
    return {
        "status": "ready",
        "task_id": "TF28524",
        "services": ["frontend (nginx)", "backend (fastapi)", "postgres:16", "redis:7", "minio"],
        "counts": {
            "schools": len(in_memory_schools),
            "classes": len(in_memory_classes),
            "users": len(in_memory_users),
            "snapshots": len(in_memory_snapshots),
            "bonus_score_logs": len(in_memory_score_logs),
            "exam_subjects": len(DEMO_SUBJECTS_METADATA),
        },
        "available_exam_subjects": list(DEMO_SUBJECTS_METADATA.keys()),
        "accounts": get_demo_accounts_directory(),
    }


@router.get("/accounts", summary="TF28524: Danh sách tài khoản lớp học Demo (Admin, Giáo viên, Học sinh, Phụ huynh)")
async def list_demo_accounts():
    seed_demo_environment(force=False)
    accounts = get_demo_accounts_directory()
    return {
        "count": len(accounts),
        "items": accounts,
    }


@router.get("/exams", summary="TF28524: Danh sách bộ đề mẫu 4 môn Toán, Lý, Hóa, Anh")
async def list_demo_exams(
    mode: str = Query("STUDENT", description="STUDENT (ẩn đáp án) hoặc TEACHER (hiện đáp án & lời giải)"),
):
    items = []
    for subj, meta in DEMO_SUBJECTS_METADATA.items():
        raw_text = load_demo_exam_raw_text(subj)
        parsed = exam_service.parse_text(raw_text, title=meta["title"])
        filtered = exam_service.filter_by_mode(parsed, mode=mode)
        items.append(
            {
                "subject": subj,
                "exam_code": meta["code"],
                "title": meta["title"],
                "grade_level": meta["grade_level"],
                "mode": filtered["mode"],
                "total_questions": filtered["total_questions"],
                "questions": filtered["questions"],
            }
        )
    return {
        "count": len(items),
        "subjects": list(DEMO_SUBJECTS_METADATA.keys()),
        "items": items,
    }


@router.get("/exams/{subject}", summary="TF28524: Lấy đề mẫu Demo chi tiết theo môn (TOAN, VAT_LY, HOA_HOC, TIENG_ANH)")
async def get_demo_exam_by_subject(
    subject: str,
    mode: Optional[str] = Query("STUDENT", description="STUDENT hoặc TEACHER"),
):
    aliases = {
        "MATH": "TOAN",
        "PHYS": "VAT_LY",
        "CHEM": "HOA_HOC",
        "ENG": "TIENG_ANH",
    }
    norm = aliases.get(subject.strip().upper(), subject.strip().upper())
    meta = DEMO_SUBJECTS_METADATA.get(norm)
    if not meta:
        raise HTTPException(
            status_code=404,
            detail=f"Môn học '{subject}' không nằm trong bộ đề Demo (hỗ trợ: TOAN, VAT_LY, HOA_HOC, TIENG_ANH).",
        )

    raw_text = load_demo_exam_raw_text(norm)
    parsed = exam_service.parse_text(raw_text, title=meta["title"])
    filtered = exam_service.filter_by_mode(parsed, mode=mode or "STUDENT")
    return {
        "subject": norm,
        "exam_code": meta["code"],
        "title": meta["title"],
        "grade_level": meta["grade_level"],
        **filtered,
    }


@router.post("/reseed", summary="TF28524: Khôi phục nhanh toàn bộ dữ liệu mẫu Demo trước giờ thuyết trình")
async def reseed_demo_data():
    summary = seed_demo_environment(force=True)
    return {
        "status": "reseeded",
        **summary,
    }
