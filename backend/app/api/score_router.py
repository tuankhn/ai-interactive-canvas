import base64
from datetime import datetime, timezone
import re
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Header, HTTPException, Query, status

from app.api.auth_router import (
    assert_user_can_access_class,
    get_current_user_from_header,
    require_role,
)
from app.api.session_router import store_snapshot_record_from_base64
from app.core.config import settings
from app.core.database import (
    in_memory_class_rosters,
    in_memory_score_logs,
    in_memory_snapshots,
    in_memory_users,
    trim_in_memory_stores,
)
from app.schemas.score import (
    BonusPointAwardRequest,
    BonusPointAwardResponse,
    BonusScoreLogOut,
    StudentRosterCreateRequest,
    StudentScoreListResponse,
    StudentScoreSummary,
)

router = APIRouter(
    prefix="/api/v1/scores",
    tags=["Student Roster & Bonus Scores Sidebar (TF2851C)"],
)

DEFAULT_DEMO_STUDENTS = [
    ("HS-01", "Nguyễn Minh Anh"),
    ("HS-02", "Trần Quốc Bảo"),
    ("HS-03", "Lê Thảo Vy"),
    ("HS-04", "Phạm Gia Huy"),
    ("HS-05", "Vũ Khánh Linh"),
]


def _norm_class(class_name: str) -> str:
    return re.sub(r"\s+", "", (class_name or "10A1").strip()).upper() or "10A1"


def _ensure_class_roster(class_name: str) -> List[Dict[str, Any]]:
    norm = _norm_class(class_name)
    if norm not in in_memory_class_rosters:
        if settings.APP_ENV == "development":
            in_memory_class_rosters[norm] = [
                {
                    "student_id": f"stu_{norm.lower()}_{idx + 1}",
                    "student_code": f"{norm}-{code}",
                    "full_name": name,
                    "class_name": norm,
                }
                for idx, (code, name) in enumerate(DEFAULT_DEMO_STUDENTS)
            ]
        else:
            in_memory_class_rosters[norm] = []
    return in_memory_class_rosters[norm]


def _collect_class_students(class_name: str) -> List[Dict[str, Any]]:
    norm = _norm_class(class_name)
    roster = _ensure_class_roster(norm)
    merged: Dict[str, Dict[str, Any]] = {}
    seen_codes = set()

    for stu in roster:
        sid = stu["student_id"]
        merged[sid] = dict(stu)
        if stu.get("student_code"):
            seen_codes.add(stu["student_code"].upper())

    for user in in_memory_users.values():
        if user.get("role") != "STUDENT":
            continue
        user_cls = _norm_class(user.get("class_name") or "")
        if user_cls != norm:
            continue
        code = (user.get("student_code") or "").upper()
        if user["id"] in merged or (code and code in seen_codes):
            continue
        merged[user["id"]] = {
            "student_id": user["id"],
            "student_code": user.get("student_code"),
            "full_name": user.get("full_name") or "Học sinh",
            "class_name": norm,
        }

    return list(merged.values())


def _compute_student_totals(student_id: str, class_name: str) -> tuple[float, int]:
    norm = _norm_class(class_name)
    matched = [
        log
        for log in in_memory_score_logs
        if log["student_id"] == student_id and _norm_class(log["class_name"]) == norm
    ]
    total = round(sum(float(log["points_added"]) for log in matched), 2)
    return total, len(matched)


@router.get("/students", response_model=StudentScoreListResponse, summary="TF2851C: Danh sách học sinh theo lớp kèm tổng điểm thưởng")
async def list_class_students(
    class_name: str = Query(default="10A1", description="Tên lớp đang giảng dạy"),
    q: Optional[str] = Query(default=None, description="Từ khóa tìm tên/mã học sinh"),
    authorization: Optional[str] = Header(default=None),
):
    user = get_current_user_from_header(authorization, required=settings.AUTH_ENFORCE)
    assert_user_can_access_class(user, requested_class_name=class_name)
    norm = _norm_class(class_name)
    students = _collect_class_students(norm)
    keyword = (q or "").strip().lower()

    summaries: List[StudentScoreSummary] = []
    for stu in students:
        if keyword:
            name_low = (stu.get("full_name") or "").lower()
            code_low = (stu.get("student_code") or "").lower()
            if keyword not in name_low and keyword not in code_low:
                continue
        total_pts, count = _compute_student_totals(stu["student_id"], norm)
        summaries.append(
            StudentScoreSummary(
                student_id=stu["student_id"],
                full_name=stu["full_name"],
                student_code=stu.get("student_code"),
                class_name=norm,
                total_points=total_pts,
                award_count=count,
            )
        )

    return StudentScoreListResponse(class_name=norm, count=len(summaries), items=summaries)


@router.post("/students", status_code=status.HTTP_201_CREATED, summary="TF2851C: Thêm nhanh học sinh vào thanh danh sách lớp")
async def add_student_to_roster(
    payload: StudentRosterCreateRequest,
    authorization: Optional[str] = Header(default=None),
):
    user = require_role(authorization, "TEACHER", "ADMIN")
    assert_user_can_access_class(user, requested_class_name=payload.class_name)
    norm = _norm_class(payload.class_name)
    roster = _ensure_class_roster(norm)
    norm_code = (payload.student_code or "").strip().upper() or f"{norm}-HS-{len(roster) + 1:02d}"

    for existing in roster:
        if (existing.get("student_code") or "").upper() == norm_code:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Mã học sinh '{norm_code}' đã có trong danh sách lớp {norm}.",
            )

    student = {
        "student_id": f"stu_{uuid.uuid4().hex[:10]}",
        "student_code": norm_code,
        "full_name": payload.full_name.strip(),
        "class_name": norm,
    }
    roster.append(student)
    return {
        "status": "added",
        "student": StudentScoreSummary(**student, total_points=0.0, award_count=0),
    }


async def award_bonus_points_core(
    payload: BonusPointAwardRequest,
    *,
    teacher_name_override: Optional[str] = None,
    allow_autocreate_student: bool = True,
) -> BonusPointAwardResponse:
    """Logic lõi cộng điểm thưởng học sinh (dùng chung cho HTTP handler và benchmark)."""
    norm = _norm_class(payload.class_name)
    students = _collect_class_students(norm)
    matched_student = next((s for s in students if s["student_id"] == payload.student_id), None)

    if not matched_student:
        user_rec = in_memory_users.get(payload.student_id)
        if user_rec:
            matched_student = {
                "student_id": user_rec["id"],
                "full_name": user_rec.get("full_name") or payload.student_name or "Học sinh",
                "student_code": user_rec.get("student_code"),
                "class_name": norm,
            }
        elif payload.student_name and allow_autocreate_student:
            matched_student = {
                "student_id": payload.student_id,
                "full_name": payload.student_name.strip(),
                "student_code": None,
                "class_name": norm,
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy học sinh '{payload.student_id}' trong lớp {norm}.",
            )

    effective_teacher = teacher_name_override or payload.teacher_name
    snapshot_id = payload.snapshot_id
    snapshot_url: Optional[str] = None
    snapshot_saved = False

    if payload.image_base64:
        try:
            snap_rec = store_snapshot_record_from_base64(
                image_base64=payload.image_base64,
                session_id=payload.session_id,
                room_id=payload.room_id,
                class_name=norm,
                teacher_name=effective_teacher,
                subject=payload.subject,
                period_number=payload.period_number,
                page_number=payload.page_number,
                trigger_type="BONUS_SCORE",
                recognized_latex="",
                ocr_text_metadata=f"Cộng +{payload.points_added} điểm cho {matched_student['full_name']}: {payload.reason}",
                extra_tags={
                    "student_id": matched_student["student_id"],
                    "student_name": matched_student["full_name"],
                },
            )
            snapshot_id = snap_rec["id"]
            snapshot_url = snap_rec["image_url"]
            snapshot_saved = True
        except Exception:
            snapshot_saved = False
    elif snapshot_id:
        snap = next((s for s in in_memory_snapshots if s.get("id") == snapshot_id), None)
        if snap:
            snapshot_url = snap.get("image_url")
            snapshot_saved = True

    now_iso = datetime.now(timezone.utc).isoformat()
    prev_total, _ = _compute_student_totals(matched_student["student_id"], norm)
    new_total = round(prev_total + float(payload.points_added), 2)

    record = BonusScoreLogOut(
        id=f"score_{uuid.uuid4().hex[:12]}",
        student_id=matched_student["student_id"],
        student_name=matched_student["full_name"],
        student_code=matched_student.get("student_code"),
        class_name=norm,
        session_id=payload.session_id,
        room_id=payload.room_id,
        teacher_name=effective_teacher,
        subject=payload.subject,
        points_added=float(payload.points_added),
        total_points=new_total,
        reason=payload.reason.strip() or "Làm bài tốt trên bảng",
        snapshot_id=snapshot_id,
        snapshot_url=snapshot_url,
        created_at=now_iso,
    )
    in_memory_score_logs.insert(0, record.model_dump())
    trim_in_memory_stores()

    return BonusPointAwardResponse(
        status="awarded",
        record=record,
        total_points=new_total,
        snapshot_saved=snapshot_saved,
    )


@router.post("/award", response_model=BonusPointAwardResponse, summary="TF2851C: Cộng điểm thưởng cho học sinh và lưu kèm snapshot bài làm")
async def award_bonus_points(
    payload: BonusPointAwardRequest,
    authorization: Optional[str] = Header(default=None),
):
    user = require_role(authorization, "TEACHER", "ADMIN")
    assert_user_can_access_class(user, requested_class_name=payload.class_name, requested_room_id=payload.room_id)
    teacher_override = user.get("full_name") if user else None
    return await award_bonus_points_core(
        payload,
        teacher_name_override=teacher_override,
        allow_autocreate_student=(not settings.AUTH_ENFORCE),
    )


async def get_bonus_score_history_core(
    class_name: Optional[str] = None,
    student_id: Optional[str] = None,
    session_id: Optional[str] = None,
    room_id: Optional[str] = None,
) -> dict:
    """Logic lõi truy vấn lịch sử cộng điểm thưởng."""
    cls_str = class_name if isinstance(class_name, str) else None
    stu_str = student_id if isinstance(student_id, str) else None
    sess_str = session_id if isinstance(session_id, str) else None
    room_str = room_id if isinstance(room_id, str) else None

    norm_cls = _norm_class(cls_str) if cls_str else None
    items = [
        log
        for log in in_memory_score_logs
        if (not norm_cls or _norm_class(log["class_name"]) == norm_cls)
        and (not stu_str or log["student_id"] == stu_str)
        and (not sess_str or log["session_id"] == sess_str)
        and (not room_str or log.get("room_id") == room_str)
    ]
    return {"count": len(items), "items": items}


@router.get("/history", summary="TF2851C: Lịch sử cộng điểm thưởng kèm snapshot bài làm")
async def get_bonus_score_history(
    class_name: Optional[str] = Query(default=None),
    student_id: Optional[str] = Query(default=None),
    session_id: Optional[str] = Query(default=None),
    room_id: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    user = get_current_user_from_header(authorization, required=settings.AUTH_ENFORCE)
    cls_str = class_name if isinstance(class_name, str) else None
    room_str = room_id if isinstance(room_id, str) else None
    assert_user_can_access_class(user, requested_class_name=cls_str, requested_room_id=room_str)
    return await get_bonus_score_history_core(
        class_name=class_name,
        student_id=student_id,
        session_id=session_id,
        room_id=room_id,
    )


@router.get("/leaderboard", summary="TF2851C: Bảng xếp hạng điểm thưởng trong lớp")
async def get_class_leaderboard(
    class_name: str = Query(default="10A1"),
    authorization: Optional[str] = Header(default=None),
):
    resp = await list_class_students(class_name=class_name, q=None, authorization=authorization)
    ranked = sorted(resp.items, key=lambda x: (-x.total_points, -x.award_count, x.full_name))
    return {"class_name": resp.class_name, "count": len(ranked), "items": ranked}
