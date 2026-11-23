import base64
from io import BytesIO
import pytest
from PIL import Image
from fastapi.testclient import TestClient

from app.core.config import settings, validate_production_secrets
from app.core.database import (
    in_memory_snapshot_blobs,
    in_memory_snapshots,
    trim_in_memory_stores,
)
from app.main import app

client = TestClient(app)


def _tiny_png_uri() -> str:
    img = Image.new("RGB", (20, 20), color=(15, 118, 110))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def test_n12_production_startup_refuses_default_secrets(monkeypatch):
    """N12: Khi APP_ENV='production' mà vẫn dùng SECRET_KEY / ADMIN_PASSWORD / MINIO_SECRET_KEY mặc định -> từ chối khởi động."""
    monkeypatch.setattr(settings, "APP_ENV", "production")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        validate_production_secrets(settings)

    monkeypatch.setattr(settings, "SECRET_KEY", "a_very_strong_custom_production_secret_key_64b")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "StrongProdAdmin!2026")
    monkeypatch.setattr(settings, "MINIO_SECRET_KEY", "StrongMinioSecret!2026")
    validate_production_secrets(settings)  # Đã đổi hết khóa nhạy cảm -> cho phép khởi động


def test_n14_offline_sync_isolates_client_sync_id_across_rooms_and_hides_raw_exception():
    """N14: client_sync_id trùng từ lớp/phòng khác không lộ snapshot_id/image_url của lớp gốc; lỗi không trả raw exception."""
    shared_sync_id = "n14-collision-sync-001"
    r_a = client.post(
        "/api/v1/offline-sync/snapshots",
        json={
            "items": [
                {
                    "client_sync_id": shared_sync_id,
                    "session_id": "sess-10a1",
                    "room_id": "room-10a1",
                    "class_name": "10A1",
                    "image_base64": _tiny_png_uri(),
                }
            ]
        },
    )
    assert r_a.status_code == 200
    snap_10a1 = r_a.json()["results"][0]["snapshot_id"]

    # Phòng/lớp khác gửi trùng client_sync_id -> KHÔNG được trả về snapshot_id của lớp 10A1
    r_b = client.post(
        "/api/v1/offline-sync/snapshots",
        json={
            "items": [
                {
                    "client_sync_id": shared_sync_id,
                    "session_id": "sess-11b2",
                    "room_id": "room-11b2",
                    "class_name": "11B2",
                    "image_base64": _tiny_png_uri(),
                }
            ]
        },
    )
    assert r_b.status_code == 200
    res_b = r_b.json()["results"][0]
    assert res_b["status"] == "synced"
    assert res_b["snapshot_id"] != snap_10a1

    # Dữ liệu hỏng không làm rò rỉ thông báo exception nội bộ của Python/Pillow
    bad = client.post(
        "/api/v1/offline-sync/snapshots",
        json={
            "items": [
                {
                    "client_sync_id": "n14-corrupt-b64",
                    "session_id": "sess-10a1",
                    "room_id": "room-10a1",
                    "class_name": "10A1",
                    "image_base64": "%%%invalid-base64%%%",
                }
            ]
        },
    )
    assert bad.status_code == 200
    err_msg = bad.json()["results"][0]["error"]
    assert "Incorrect padding" not in err_msg and "binascii" not in err_msg


def test_m7_trim_in_memory_stores_evicts_oldest_snapshots_and_blobs(monkeypatch):
    """M7: Khi vượt ngưỡng MAX_IN_MEMORY_SNAPSHOTS, tự động cắt bỏ bản ghi cũ nhất kèm blob nhị phân."""
    monkeypatch.setattr(settings, "MAX_IN_MEMORY_SNAPSHOTS", 12)
    saved_snaps = list(in_memory_snapshots)
    saved_blobs = dict(in_memory_snapshot_blobs)
    try:
        in_memory_snapshots.clear()
        in_memory_snapshot_blobs.clear()
        for idx in range(18):
            sid = f"m7-snap-{idx}"
            in_memory_snapshots.insert(0, {"id": sid, "tags": {"class_name": "10A1"}})
            in_memory_snapshot_blobs[sid] = b"blob"
        trim_in_memory_stores()
        assert len(in_memory_snapshots) == 12
        assert "m7-snap-0" not in in_memory_snapshot_blobs
        assert "m7-snap-17" in in_memory_snapshot_blobs
    finally:
        in_memory_snapshots[:] = saved_snaps
        in_memory_snapshot_blobs.clear()
        in_memory_snapshot_blobs.update(saved_blobs)
