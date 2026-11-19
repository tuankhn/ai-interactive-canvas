import base64
from io import BytesIO
import time
from PIL import Image
from fastapi.testclient import TestClient

from app.core.database import (
    in_memory_otps,
    in_memory_refresh_sessions,
    in_memory_snapshot_blobs,
    in_memory_snapshots,
    in_memory_student_bindings,
    in_memory_users,
)
from app.main import app

client = TestClient(app)


def _tiny_png_b64() -> str:
    img = Image.new("RGB", (120, 80), color=(255, 255, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def _reset_portal_stores():
    in_memory_users.clear()
    in_memory_student_bindings.clear()
    in_memory_otps.clear()
    in_memory_refresh_sessions.clear()
    in_memory_snapshots.clear()
    in_memory_snapshot_blobs.clear()


def test_student_portal_lessons_calendar_counts_date_and_subject_filters():
    _reset_portal_stores()

    stu = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Trần Minh Thư",
            "phone_number": "0912000111",
            "password": "Password123",
            "school_level": "THPT",
            "class_name": "10A1",
            "student_code": "HS-PORTAL-01",
        },
    )
    assert stu.status_code == 200
    token = stu.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    img_b64 = _tiny_png_b64()
    s1 = client.post(
        "/api/v1/sessions/snapshots",
        json={
            "session_id": "s1",
            "room_id": "room-10a1",
            "teacher_name": "Cô Lan",
            "class_name": "10A1",
            "subject": "TOAN",
            "period_number": 1,
            "recognized_latex": "Parabol y = x^2 - 4x + 3",
            "image_base64": img_b64,
        },
    ).json()
    client.post(
        "/api/v1/sessions/snapshots",
        json={
            "session_id": "s2",
            "room_id": "room-10a1",
            "teacher_name": "Thầy Hùng",
            "class_name": "10A1",
            "subject": "VAT_LY",
            "period_number": 2,
            "recognized_latex": "Định luật Newton F = m*a",
            "image_base64": img_b64,
        },
    )
    # Lớp khác -> không được lộ sang học sinh lớp 10A1
    s_other = client.post(
        "/api/v1/sessions/snapshots",
        json={
            "session_id": "s3",
            "room_id": "room-10a2",
            "teacher_name": "Cô Mai",
            "class_name": "10A2",
            "subject": "TOAN",
            "recognized_latex": "Bài riêng lớp 10A2",
            "image_base64": img_b64,
        },
    ).json()

    today_str = s1["tags"]["date"]
    all_res = client.get("/api/v1/auth/student/lessons", headers=headers)
    assert all_res.status_code == 200
    body = all_res.json()
    assert body["total_count"] == 2
    assert body["calendar_counts"][today_str] == 2
    assert all(item["tags"]["class_name"] == "10A1" for item in body["items"])

    # Lọc theo môn + ngày + từ khóa
    filtered = client.get(
        "/api/v1/auth/student/lessons",
        headers=headers,
        params={"subject": "TOAN", "date": today_str, "q": "Parabol", "limit": 12, "offset": 0},
    )
    assert filtered.status_code == 200
    assert filtered.json()["total_count"] == 1
    assert filtered.json()["items"][0]["id"] == s1["snapshot_id"]

    # Học sinh 10A1 không được tải ảnh của lớp 10A2
    forbidden_img = client.get(
        f"/api/v1/sessions/snapshots/{s_other['snapshot_id']}/image",
        params={"token": token},
    )
    assert forbidden_img.status_code == 403


def test_student_portal_highres_png_and_webp_download():
    _reset_portal_stores()

    stu = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Bé Nam",
            "phone_number": "0988111222",
            "password": "Password123",
            "school_level": "TIEU_HOC",
            "class_name": "5B",
            "student_code": "HS-5B-PORTAL",
            "role": "PARENT",
        },
    ).json()
    token = stu["access_token"]

    snap = client.post(
        "/api/v1/sessions/snapshots",
        json={
            "session_id": "s-5b",
            "room_id": "room-5b",
            "teacher_name": "Cô Hoa",
            "class_name": "5B",
            "subject": "TOAN",
            "recognized_latex": "Diện tích hình thang",
            "image_base64": _tiny_png_b64(),
        },
    ).json()
    snap_id = snap["snapshot_id"]

    webp_res = client.get(
        f"/api/v1/sessions/snapshots/{snap_id}/image",
        params={"format": "webp", "token": token},
    )
    assert webp_res.status_code == 200
    assert webp_res.headers["content-type"].startswith("image/webp")
    assert webp_res.content[:4] == b"RIFF"

    png_res = client.get(
        f"/api/v1/sessions/snapshots/{snap_id}/image",
        params={"format": "png", "download": "true", "token": token},
    )
    assert png_res.status_code == 200
    assert png_res.headers["content-type"].startswith("image/png")
    assert "attachment;" in png_res.headers.get("content-disposition", "")
    assert png_res.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_student_portal_first_page_load_under_1500ms_and_assets_served():
    _reset_portal_stores()

    stu = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Lê Quang Minh",
            "phone_number": "0977333444",
            "password": "Password123",
            "school_level": "THCS",
            "class_name": "8A",
            "student_code": "HS-8A-SPEED",
        },
    ).json()
    headers = {"Authorization": f"Bearer {stu['access_token']}"}
    img_b64 = _tiny_png_b64()

    for idx in range(15):
        client.post(
            "/api/v1/sessions/snapshots",
            json={
                "session_id": f"s-8a-{idx}",
                "room_id": "room-8a",
                "class_name": "8A",
                "subject": "TOAN",
                "recognized_latex": f"Bài giảng số {idx + 1}",
                "image_base64": img_b64,
            },
        )

    t0 = time.perf_counter()
    html_res = client.get("/src/pages/student_portal.html")
    js_res = client.get("/src/pages/student_portal.js")
    first_page = client.get("/api/v1/auth/student/lessons", headers=headers, params={"limit": 12, "offset": 0})
    elapsed_ms = (time.perf_counter() - t0) * 1000

    assert html_res.status_code == 200
    assert js_res.status_code == 200
    assert first_page.status_code == 200
    assert first_page.json()["count"] == 12
    assert first_page.json()["total_count"] == 15
    assert elapsed_ms < 1500.0
    assert 'id="snapshotLightboxDialog"' in html_res.text
    assert 'id="calendarDaysGrid"' in html_res.text
    assert "fetchpriority" in js_res.text
    assert 'loading = \'lazy\'' in js_res.text or 'loading="lazy"' in js_res.text
