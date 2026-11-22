from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List
from PIL import Image, ImageDraw

from app.core.config import settings
from app.core.database import (
    in_memory_ai_usage_logs,
    in_memory_class_rosters,
    in_memory_classes,
    in_memory_pages,
    in_memory_schools,
    in_memory_score_logs,
    in_memory_sessions,
    in_memory_snapshot_blobs,
    in_memory_snapshots,
    in_memory_student_bindings,
    in_memory_users,
)
from app.core.security import get_password_hash

DEMO_SUBJECTS_METADATA: Dict[str, Dict[str, str]] = {
    "TOAN": {
        "code": "DEMO-EXAM-TOAN-10",
        "title": "Đề mẫu Demo môn Toán 10 — Hàm số bậc hai, Giới hạn & Hình học",
        "grade_level": "10",
        "file_name": "de_mau_toan_10a1.txt",
    },
    "VAT_LY": {
        "code": "DEMO-EXAM-VATLY-10",
        "title": "Đề mẫu Demo môn Vật lý 10 — Động lực học & Bảo toàn cơ năng",
        "grade_level": "10",
        "file_name": "de_mau_vat_ly_10a1.txt",
    },
    "HOA_HOC": {
        "code": "DEMO-EXAM-HOAHOC-10",
        "title": "Đề mẫu Demo môn Hóa học 10 — Cấu tạo phân tử, Mol & Phản ứng hóa học",
        "grade_level": "10",
        "file_name": "de_mau_hoa_hoc_10a1.txt",
    },
    "TIENG_ANH": {
        "code": "DEMO-EXAM-TIENGANH-10",
        "title": "Đề mẫu Demo môn Tiếng Anh 10 — Phonetics, Grammar & Science Vocabulary",
        "grade_level": "10",
        "file_name": "de_mau_tieng_anh_10a1.txt",
    },
}


def _render_demo_chalkboard_bytes(
    *,
    subject_label: str,
    class_name: str,
    teacher_name: str,
    headline: str,
    formula_line: str,
    accent_rgb=(56, 189, 248),
) -> bytes:
    """Tạo ảnh bảng đen phấn trắng sắc nét phục vụ xem lại bài học Demo trên Cổng HS/PH & Admin."""
    img = Image.new("RGB", (960, 540), color=(15, 23, 42))
    draw = ImageDraw.Draw(img)

    # Viền khung gỗ bảng lớp học
    draw.rectangle([12, 12, 948, 528], outline=accent_rgb, width=4)
    draw.rectangle([24, 24, 936, 92], fill=(30, 41, 59))

    draw.text((42, 46), f"LOP {class_name}  |  MON: {subject_label}  |  GV: {teacher_name}", fill=(248, 250, 252))
    draw.text((48, 138), headline, fill=accent_rgb)
    draw.line([(48, 178), (900, 178)], fill=(71, 85, 105), width=2)
    draw.text((48, 215), formula_line, fill=(254, 249, 195))
    draw.text((48, 290), "Ghi chu tren bang thong minh AI Interactive Canvas (Demo Ready)", fill=(148, 163, 184))

    # Hình minh họa trực quan góc phải bảng
    draw.ellipse([690, 210, 880, 400], outline=accent_rgb, width=3)
    draw.line([(670, 305), (900, 305)], fill=(100, 116, 139), width=2)
    draw.line([(785, 190), (785, 420)], fill=(100, 116, 139), width=2)

    buf = BytesIO()
    img.save(buf, format="WEBP", quality=90)
    return buf.getvalue()


def load_demo_exam_raw_text(subject: str) -> str:
    """Đọc nội dung đề mẫu Toán, Lý, Hóa, Anh từ docs/demo_exams (hoặc fallback nội bộ)."""
    norm = (subject or "TOAN").strip().upper()
    meta = DEMO_SUBJECTS_METADATA.get(norm)
    if meta:
        candidates = [
            Path("/docs/demo_exams") / meta["file_name"],
            Path(__file__).resolve().parents[3] / "docs" / "demo_exams" / meta["file_name"],
        ]
        for path in candidates:
            if path.is_file():
                return path.read_text(encoding="utf-8")

    from app.services.exam_service import exam_service
    return exam_service.get_sample_exam(norm)


def get_demo_accounts_directory() -> List[Dict[str, Any]]:
    """Danh mục tài khoản Demo hiển thị cho nhóm báo cáo viên."""
    demo_pw = settings.DEMO_DEFAULT_PASSWORD
    return [
        {
            "role": "ADMIN",
            "portal_url": "/src/pages/admin.html",
            "full_name": "Quản Trị Viên Hệ Thống",
            "login_identifier": settings.ADMIN_EMAIL,
            "phone_number": "0900000001",
            "password": settings.ADMIN_PASSWORD,
            "classes": ["10A1", "12A1", "8A2", "4A1"],
            "note": "Quản lý trường, lớp, giáo viên và hạn ngạch Gemini/Mathpix/MinIO",
        },
        {
            "role": "TEACHER",
            "portal_url": "/",
            "full_name": "Thầy Nguyễn Tuấn Khang",
            "login_identifier": "gv.toan@aicanvas.edu.vn",
            "phone_number": "0901000101",
            "password": demo_pw,
            "dev_otp_code": "123456",
            "classes": ["10A1", "12A1"],
            "note": "Giáo viên Toán & Vật lý (THPT Chuyên Lê Hồng Phong)",
        },
        {
            "role": "TEACHER",
            "portal_url": "/",
            "full_name": "Cô Hoàng Minh Châu",
            "login_identifier": "gv.hoaanh@aicanvas.edu.vn",
            "phone_number": "0901000102",
            "password": demo_pw,
            "dev_otp_code": "123456",
            "classes": ["10A1", "8A2"],
            "note": "Giáo viên Hóa học & Tiếng Anh",
        },
        {
            "role": "TEACHER",
            "portal_url": "/",
            "full_name": "Cô Trần Thanh Thảo",
            "login_identifier": "gv.tieuhoc@aicanvas.edu.vn",
            "phone_number": "0901000103",
            "password": demo_pw,
            "dev_otp_code": "123456",
            "classes": ["4A1"],
            "note": "Giáo viên Chủ nhiệm Lớp 4A1 (Tiểu học Kim Đồng)",
        },
        {
            "role": "STUDENT",
            "portal_url": "/src/pages/student_portal.html",
            "full_name": "Nguyễn Minh Anh",
            "login_identifier": "0912000101",
            "phone_number": "0912000101",
            "password": demo_pw,
            "student_code": "10A1-HS-01",
            "classes": ["10A1"],
            "note": "Học sinh lớp 10A1 — có sẵn bài học 4 môn Toán, Lý, Hóa, Anh & điểm thưởng",
        },
        {
            "role": "STUDENT",
            "portal_url": "/src/pages/student_portal.html",
            "full_name": "Trần Quốc Bảo",
            "login_identifier": "0912000102",
            "phone_number": "0912000102",
            "password": demo_pw,
            "student_code": "10A1-HS-02",
            "classes": ["10A1"],
            "note": "Học sinh lớp 10A1",
        },
        {
            "role": "STUDENT",
            "portal_url": "/src/pages/student_portal.html",
            "full_name": "Phạm Khánh Vy",
            "login_identifier": "0912000802",
            "phone_number": "0912000802",
            "password": demo_pw,
            "student_code": "8A2-HS-01",
            "classes": ["8A2"],
            "note": "Học sinh lớp 8A2 (THCS) — dùng để demo phân quyền cô lập lớp học",
        },
        {
            "role": "PARENT",
            "portal_url": "/src/pages/student_portal.html",
            "full_name": "Phụ huynh Bé Lê Gia Hân",
            "login_identifier": "0912000401",
            "phone_number": "0912000401",
            "password": demo_pw,
            "student_code": "4A1-HS-01",
            "classes": ["4A1"],
            "note": "Phụ huynh Tiểu học lớp 4A1 xem bài học của con tại nhà",
        },
    ]


def seed_demo_environment(force: bool = False) -> Dict[str, Any]:
    """
    Khởi tạo trọn bộ dữ liệu mẫu Demo cho hệ thống (Idempotent — an toàn tuyệt đối khi gọi lặp lại).
    Bao gồm: Trường học, Lớp học, Tài khoản (Admin/GV/HS/PH), Ảnh bảng 4 môn Toán-Lý-Hóa-Anh,
    Danh sách học sinh & Lịch sử điểm thưởng, Nhật ký AI và Bộ đề mẫu 4 môn.
    """
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    today_str = now_iso[:10]
    yesterday_str = (now_dt - timedelta(days=1)).isoformat()[:10]
    retention_iso = (now_dt + timedelta(days=180)).isoformat()

    admin_hash = get_password_hash(settings.ADMIN_PASSWORD)
    demo_hash = get_password_hash(settings.DEMO_DEFAULT_PASSWORD)

    # 1. Seed Trường học
    demo_schools = [
        {
            "id": "sch_demo_thpt_lhp",
            "code": "THPT_LHP",
            "name": "Trường THPT Chuyên Lê Hồng Phong",
            "level": "THPT",
            "address": "235 Nguyễn Văn Cừ, Quận 5, TP.HCM",
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "sch_demo_thcs_ntp",
            "code": "THCS_NTP",
            "name": "Trường THCS Nguyễn Tri Phương",
            "level": "THCS",
            "address": "224 Nguyễn Tri Phương, Quận 10, TP.HCM",
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "sch_demo_th_kd",
            "code": "TH_KD",
            "name": "Trường Tiểu học Kim Đồng",
            "level": "TIEU_HOC",
            "address": "15 Trần Phú, Quận 5, TP.HCM",
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    ]
    existing_school_codes = {s.get("code", "").upper(): s["id"] for s in in_memory_schools.values()}
    school_id_by_code: Dict[str, str] = dict(existing_school_codes)
    for sch in demo_schools:
        if force or sch["code"] not in school_id_by_code:
            in_memory_schools[sch["id"]] = sch
            school_id_by_code[sch["code"]] = sch["id"]

    # 2. Seed Tài khoản Admin, Giáo viên, Học sinh, Phụ huynh
    demo_users = [
        {
            "id": "admin_default",
            "full_name": "Quản Trị Viên Hệ Thống",
            "email": settings.ADMIN_EMAIL.strip().lower(),
            "phone_number": "0900000001",
            "role": "ADMIN",
            "password_hash": admin_hash,
            "school_id": None,
            "school_level": None,
            "class_name": None,
            "allowed_classes": ["*"],
            "student_code": None,
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "teacher_demo_toan",
            "full_name": "Thầy Nguyễn Tuấn Khang",
            "email": "gv.toan@aicanvas.edu.vn",
            "phone_number": "0901000101",
            "role": "TEACHER",
            "password_hash": demo_hash,
            "school_id": school_id_by_code["THPT_LHP"],
            "school_level": "THPT",
            "class_name": "10A1",
            "allowed_classes": ["10A1", "12A1"],
            "student_code": None,
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "teacher_demo_hoaanh",
            "full_name": "Cô Hoàng Minh Châu",
            "email": "gv.hoaanh@aicanvas.edu.vn",
            "phone_number": "0901000102",
            "role": "TEACHER",
            "password_hash": demo_hash,
            "school_id": school_id_by_code["THPT_LHP"],
            "school_level": "THPT",
            "class_name": "10A1",
            "allowed_classes": ["10A1", "8A2"],
            "student_code": None,
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "teacher_demo_tieuhoc",
            "full_name": "Cô Trần Thanh Thảo",
            "email": "gv.tieuhoc@aicanvas.edu.vn",
            "phone_number": "0901000103",
            "role": "TEACHER",
            "password_hash": demo_hash,
            "school_id": school_id_by_code["TH_KD"],
            "school_level": "TIEU_HOC",
            "class_name": "4A1",
            "allowed_classes": ["4A1"],
            "student_code": None,
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "stu_10a1_1",
            "full_name": "Nguyễn Minh Anh",
            "email": None,
            "phone_number": "0912000101",
            "role": "STUDENT",
            "password_hash": demo_hash,
            "school_id": school_id_by_code["THPT_LHP"],
            "school_level": "THPT",
            "class_name": "10A1",
            "allowed_classes": ["10A1"],
            "student_code": "10A1-HS-01",
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "stu_10a1_2",
            "full_name": "Trần Quốc Bảo",
            "email": None,
            "phone_number": "0912000102",
            "role": "STUDENT",
            "password_hash": demo_hash,
            "school_id": school_id_by_code["THPT_LHP"],
            "school_level": "THPT",
            "class_name": "10A1",
            "allowed_classes": ["10A1"],
            "student_code": "10A1-HS-02",
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "stu_8a2_1",
            "full_name": "Phạm Khánh Vy",
            "email": None,
            "phone_number": "0912000802",
            "role": "STUDENT",
            "password_hash": demo_hash,
            "school_id": school_id_by_code["THCS_NTP"],
            "school_level": "THCS",
            "class_name": "8A2",
            "allowed_classes": ["8A2"],
            "student_code": "8A2-HS-01",
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "parent_4a1_1",
            "full_name": "Phụ huynh Bé Lê Gia Hân",
            "email": None,
            "phone_number": "0912000401",
            "role": "PARENT",
            "password_hash": demo_hash,
            "school_id": school_id_by_code["TH_KD"],
            "school_level": "TIEU_HOC",
            "class_name": "4A1",
            "allowed_classes": ["4A1"],
            "student_code": "4A1-HS-01",
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    ]

    existing_emails = {(u.get("email") or "").lower() for u in in_memory_users.values() if u.get("email")}
    existing_phones = {u.get("phone_number") for u in in_memory_users.values() if u.get("phone_number")}

    for usr in demo_users:
        email_key = (usr.get("email") or "").lower()
        phone_key = usr.get("phone_number")
        already_exists = (
            usr["id"] in in_memory_users
            or (email_key and email_key in existing_emails)
            or (phone_key and phone_key in existing_phones)
        )
        if force or not already_exists:
            in_memory_users[usr["id"]] = usr
            if email_key:
                existing_emails.add(email_key)
            if phone_key:
                existing_phones.add(phone_key)
            if usr.get("student_code"):
                in_memory_student_bindings[usr["student_code"]] = usr["id"]

    # 3. Seed Lớp học
    demo_classes = [
        {
            "id": "cls_demo_10a1",
            "school_id": school_id_by_code["THPT_LHP"],
            "name": "10A1",
            "grade": 10,
            "academic_year": "2026-2027",
            "room_id": "room-10a1",
            "homeroom_teacher_id": "teacher_demo_toan",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "cls_demo_12a1",
            "school_id": school_id_by_code["THPT_LHP"],
            "name": "12A1",
            "grade": 12,
            "academic_year": "2026-2027",
            "room_id": "room-12a1",
            "homeroom_teacher_id": "teacher_demo_toan",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "cls_demo_8a2",
            "school_id": school_id_by_code["THCS_NTP"],
            "name": "8A2",
            "grade": 8,
            "academic_year": "2026-2027",
            "room_id": "room-8a2",
            "homeroom_teacher_id": "teacher_demo_hoaanh",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "cls_demo_4a1",
            "school_id": school_id_by_code["TH_KD"],
            "name": "4A1",
            "grade": 4,
            "academic_year": "2026-2027",
            "room_id": "room-4a1",
            "homeroom_teacher_id": "teacher_demo_tieuhoc",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    ]
    existing_class_names = {c.get("name", "").upper() for c in in_memory_classes.values()}
    for cls in demo_classes:
        if force or cls["name"].upper() not in existing_class_names:
            in_memory_classes[cls["id"]] = cls
            existing_class_names.add(cls["name"].upper())

    # 4. Seed Danh sách Học sinh trên Thanh cộng điểm thưởng (10A1)
    if force or "10A1" not in in_memory_class_rosters:
        in_memory_class_rosters["10A1"] = [
            {"student_id": "stu_10a1_1", "student_code": "10A1-HS-01", "full_name": "Nguyễn Minh Anh", "class_name": "10A1"},
            {"student_id": "stu_10a1_2", "student_code": "10A1-HS-02", "full_name": "Trần Quốc Bảo", "class_name": "10A1"},
            {"student_id": "stu_10a1_3", "student_code": "10A1-HS-03", "full_name": "Lê Thảo Vy", "class_name": "10A1"},
            {"student_id": "stu_10a1_4", "student_code": "10A1-HS-04", "full_name": "Phạm Gia Huy", "class_name": "10A1"},
            {"student_id": "stu_10a1_5", "student_code": "10A1-HS-05", "full_name": "Vũ Khánh Linh", "class_name": "10A1"},
        ]

    # 5. Seed Ảnh Snapshot bài giảng mẫu 4 môn Toán, Lý, Hóa, Anh + lớp 8A2, 4A1
    demo_snapshots_spec = [
        {
            "id": "demo-snap-10a1-toan",
            "session_id": "demo-sess-10a1-toan",
            "room_id": "room-10a1",
            "class_name": "10A1",
            "subject": "TOAN",
            "subject_label": "TOAN HOC 10",
            "teacher_name": "Thầy Nguyễn Tuấn Khang",
            "period_number": 1,
            "date": today_str,
            "headline": "Khao sat & Ve do thi Parabol: y = x^2 - 4x + 3",
            "formula": "Dinh I(2; -1)   |   Nghiem x1 = 1, x2 = 3",
            "recognized_latex": "y = x^2 - 4x + 3",
            "ocr_text": "Khảo sát hàm số bậc hai y = x^2 - 4x + 3, đỉnh I(2; -1), giao điểm trục hoành x = 1, x = 3",
            "accent": (56, 189, 248),
        },
        {
            "id": "demo-snap-10a1-vatly",
            "session_id": "demo-sess-10a1-vatly",
            "room_id": "room-10a1",
            "class_name": "10A1",
            "subject": "VAT_LY",
            "subject_label": "VAT LY 10",
            "teacher_name": "Thầy Nguyễn Tuấn Khang",
            "period_number": 2,
            "date": today_str,
            "headline": "Dinh luat II Newton & Dong nang cua vat ran",
            "formula": "F = m * a     |     Wd = 1/2 * m * v^2",
            "recognized_latex": r"F = m \cdot a,\quad W_d = \frac{1}{2}mv^2",
            "ocr_text": "Định luật II Newton F = m*a và công thức Động năng Wd = 1/2 m v^2",
            "accent": (250, 204, 21),
        },
        {
            "id": "demo-snap-10a1-hoahoc",
            "session_id": "demo-sess-10a1-hoahoc",
            "room_id": "room-10a1",
            "class_name": "10A1",
            "subject": "HOA_HOC",
            "subject_label": "HOA HOC 10",
            "teacher_name": "Cô Hoàng Minh Châu",
            "period_number": 3,
            "date": yesterday_str,
            "headline": "Cau tao phan tu 3D Metan (CH4) & Phan ung dot chay",
            "formula": "CH4 + 2O2  --(t*)-->  CO2 + 2H2O",
            "recognized_latex": r"CH_4 + 2O_2 \xrightarrow{t^\circ} CO_2 + 2H_2O",
            "ocr_text": "Mô hình 3D phân tử CH4 tứ diện đều và cân bằng phản ứng đốt cháy Metan",
            "accent": (52, 211, 153),
        },
        {
            "id": "demo-snap-10a1-tienganh",
            "session_id": "demo-sess-10a1-tienganh",
            "room_id": "room-10a1",
            "class_name": "10A1",
            "subject": "TIENG_ANH",
            "subject_label": "TIENG ANH 10",
            "teacher_name": "Cô Hoàng Minh Châu",
            "period_number": 4,
            "date": yesterday_str,
            "headline": "Science Vocabulary & First Conditional Structure",
            "formula": "Photosynthesis  |  If + S + V(s/es), S + will + V",
            "recognized_latex": "If + S + V(s/es), S + will + V",
            "ocr_text": "Vocabulary Illustration: Photosynthesis, Solar System & First Conditional",
            "accent": (192, 132, 252),
        },
        {
            "id": "demo-snap-8a2-hoahoc",
            "session_id": "demo-sess-8a2-hoahoc",
            "room_id": "room-8a2",
            "class_name": "8A2",
            "subject": "HOA_HOC",
            "subject_label": "HOA HOC 8",
            "teacher_name": "Cô Hoàng Minh Châu",
            "period_number": 1,
            "date": today_str,
            "headline": "Dinh luat Bao toan khoi luong (Lop 8A2)",
            "formula": "m_Fe + m_S = m_FeS",
            "recognized_latex": "m_{Fe} + m_S = m_{FeS}",
            "ocr_text": "Định luật bảo toàn khối lượng lớp 8A2: m_Fe + m_S = m_FeS",
            "accent": (52, 211, 153),
        },
        {
            "id": "demo-snap-4a1-toan",
            "session_id": "demo-sess-4a1-toan",
            "room_id": "room-4a1",
            "class_name": "4A1",
            "subject": "TOAN",
            "subject_label": "TOAN LOP 4",
            "teacher_name": "Cô Trần Thanh Thảo",
            "period_number": 1,
            "date": today_str,
            "headline": "Chu vi va Dien tich Hinh chu nhat (Lop 4A1)",
            "formula": "P = (a + b) x 2   |   S = a x b",
            "recognized_latex": r"P = (a + b) \times 2",
            "ocr_text": "Toán Tiểu học 4A1: Chu vi và diện tích hình chữ nhật P = (a + b) x 2",
            "accent": (56, 189, 248),
        },
    ]

    existing_snap_ids = {s.get("id") for s in in_memory_snapshots}
    for spec in demo_snapshots_spec:
        if force or spec["id"] not in existing_snap_ids:
            blob = _render_demo_chalkboard_bytes(
                subject_label=spec["subject_label"],
                class_name=spec["class_name"],
                teacher_name=spec["teacher_name"],
                headline=spec["headline"],
                formula_line=spec["formula"],
                accent_rgb=spec["accent"],
            )
            in_memory_snapshot_blobs[spec["id"]] = blob
            preview_url = f"/api/v1/sessions/snapshots/{spec['id']}/image?format=webp"
            record = {
                "id": spec["id"],
                "session_id": spec["session_id"],
                "room_id": spec["room_id"],
                "tags": {
                    "teacher_name": spec["teacher_name"],
                    "class_name": spec["class_name"],
                    "subject": spec["subject"],
                    "period_number": spec["period_number"],
                    "page_number": 1,
                    "date": spec["date"],
                },
                "trigger_type": "MANUAL_SAVE",
                "image_url": preview_url,
                "preview_url": preview_url,
                "image_format": "webp",
                "size_bytes": len(blob),
                "ocr_text_metadata": spec["ocr_text"],
                "recognized_latex": spec["recognized_latex"],
                "created_at": f"{spec['date']}T08:30:00+00:00",
                "retention_until": retention_iso,
            }
            if force:
                in_memory_snapshots[:] = [s for s in in_memory_snapshots if s.get("id") != spec["id"]]
            in_memory_snapshots.append(record)
            existing_snap_ids.add(spec["id"])

            page_key = f"{spec['room_id']}:{spec['session_id']}"
            in_memory_sessions[spec["session_id"]] = {
                "session_id": spec["session_id"],
                "room_id": spec["room_id"],
                "class_name": spec["class_name"],
                "subject": spec["subject"],
                "teacher_name": spec["teacher_name"],
            }
            if page_key not in in_memory_pages:
                in_memory_pages[page_key] = {
                    1: {
                        "page_number": 1,
                        "canvas_json": {"version": "6.7.1", "background": "#0f172a", "objects": []},
                        "recognized_latex": spec["recognized_latex"],
                        "updated_at": now_iso,
                    }
                }

    # 6. Seed Lịch sử cộng điểm thưởng trên bảng
    existing_score_ids = {log.get("id") for log in in_memory_score_logs}
    demo_scores = [
        {
            "id": "score_demo_01",
            "student_id": "stu_10a1_1",
            "student_name": "Nguyễn Minh Anh",
            "student_code": "10A1-HS-01",
            "class_name": "10A1",
            "session_id": "demo-sess-10a1-toan",
            "room_id": "room-10a1",
            "subject": "TOAN",
            "teacher_name": "Thầy Nguyễn Tuấn Khang",
            "points_added": 2,
            "total_points_after": 2,
            "reason": "Tìm đúng đỉnh Parabol I(2; -1) và vẽ đồ thị chính xác trên bảng",
            "snapshot_id": "demo-snap-10a1-toan",
            "snapshot_url": "/api/v1/sessions/snapshots/demo-snap-10a1-toan/image?format=webp",
            "created_at": now_iso,
        },
        {
            "id": "score_demo_02",
            "student_id": "stu_10a1_2",
            "student_name": "Trần Quốc Bảo",
            "student_code": "10A1-HS-02",
            "class_name": "10A1",
            "session_id": "demo-sess-10a1-vatly",
            "room_id": "room-10a1",
            "subject": "VAT_LY",
            "teacher_name": "Thầy Nguyễn Tuấn Khang",
            "points_added": 1,
            "total_points_after": 1,
            "reason": "Khoanh đúng đáp án Động năng và đổi đơn vị chuẩn SI",
            "snapshot_id": "demo-snap-10a1-vatly",
            "snapshot_url": "/api/v1/sessions/snapshots/demo-snap-10a1-vatly/image?format=webp",
            "created_at": now_iso,
        },
    ]
    for s_log in demo_scores:
        if force or s_log["id"] not in existing_score_ids:
            if force:
                in_memory_score_logs[:] = [x for x in in_memory_score_logs if x.get("id") != s_log["id"]]
            in_memory_score_logs.append(s_log)

    # 7. Seed Nhật ký hạn ngạch AI mẫu phục vụ trang Admin
    existing_ai_ids = {item.get("id") for item in in_memory_ai_usage_logs}
    demo_ai_logs = [
        {
            "id": "ai_demo_log_01",
            "provider": "GEMINI",
            "provider_detail": "gemini-2.5-flash",
            "task_type": "OCR_LATEX",
            "subject": "TOAN",
            "session_id": "demo-sess-10a1-toan",
            "room_id": "room-10a1",
            "latency_ms": 610,
            "is_mock": False,
            "estimated_tokens": 320,
            "created_at": now_iso,
        },
        {
            "id": "ai_demo_log_02",
            "provider": "MATHPIX",
            "provider_detail": "mathpix-v3",
            "task_type": "OCR_LATEX",
            "subject": "VAT_LY",
            "session_id": "demo-sess-10a1-vatly",
            "room_id": "room-10a1",
            "latency_ms": 530,
            "is_mock": False,
            "estimated_tokens": 280,
            "created_at": now_iso,
        },
        {
            "id": "ai_demo_log_03",
            "provider": "GEMINI",
            "provider_detail": "chalkboard-gemini",
            "task_type": "VOCAB_IMAGE",
            "subject": "TIENG_ANH",
            "session_id": "demo-sess-10a1-tienganh",
            "room_id": "room-10a1",
            "latency_ms": 840,
            "is_mock": False,
            "estimated_tokens": 450,
            "created_at": now_iso,
        },
    ]
    for ai_log in demo_ai_logs:
        if force or ai_log["id"] not in existing_ai_ids:
            if force:
                in_memory_ai_usage_logs[:] = [x for x in in_memory_ai_usage_logs if x.get("id") != ai_log["id"]]
            in_memory_ai_usage_logs.append(ai_log)

    # 8. Khởi tạo trước bộ đề mẫu 4 môn Toán, Lý, Hóa, Anh để cache answer_keys sẵn sàng chấm bài
    from app.services.exam_service import exam_service

    exams_summary = []
    for subj, meta in DEMO_SUBJECTS_METADATA.items():
        raw_text = load_demo_exam_raw_text(subj)
        parsed = exam_service.parse_text(raw_text, title=meta["title"])
        exam_service.filter_by_mode(parsed, mode="STUDENT")
        exams_summary.append(
            {
                "subject": subj,
                "exam_code": meta["code"],
                "title": meta["title"],
                "grade_level": meta["grade_level"],
                "total_questions": parsed["total_questions"],
            }
        )

    return {
        "seeded": True,
        "schools_count": len(in_memory_schools),
        "classes_count": len(in_memory_classes),
        "users_count": len(in_memory_users),
        "snapshots_count": len(in_memory_snapshots),
        "demo_exams": exams_summary,
    }
