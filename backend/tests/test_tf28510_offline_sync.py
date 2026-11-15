import base64
from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import in_memory_pages, in_memory_snapshots, synced_offline_ids

client = TestClient(app)


def make_test_png_b64() -> str:
    img = Image.new("RGB", (240, 120), color=(255, 255, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def test_offline_sync_status_endpoint():
    resp = client.get("/api/v1/offline-sync/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["online"] is True
    assert data["service"] == "offline-sync"
    assert "server_time" in data


def test_offline_sync_batch_and_idempotency():
    img_b64 = make_test_png_b64()
    sync_id_1 = "offline-sync-uuid-001"
    sync_id_2 = "offline-sync-uuid-002"
    synced_offline_ids.pop(sync_id_1, None)
    synced_offline_ids.pop(sync_id_2, None)

    payload = {
        "items": [
            {
                "client_sync_id": sync_id_1,
                "session_id": "session-offline-10a1",
                "room_id": "room-10a1",
                "class_name": "10A1",
                "teacher_name": "Nguyễn Tuấn Khang",
                "subject": "TOAN",
                "period_number": 2,
                "page_number": 1,
                "trigger_type": "BEFORE_CLEAR",
                "image_base64": img_b64,
                "recognized_latex": "x^2 + 2x + 1 = 0",
                "captured_at": "2026-11-16T08:15:00+07:00",
            },
            {
                "client_sync_id": sync_id_2,
                "session_id": "session-offline-10a1",
                "room_id": "room-10a1",
                "class_name": "10A1",
                "teacher_name": "Nguyễn Tuấn Khang",
                "subject": "VAT_LY",
                "period_number": 2,
                "page_number": 2,
                "trigger_type": "MANUAL",
                "image_base64": img_b64,
                "captured_at": "2026-11-16T08:20:00+07:00",
            },
        ],
        "pages": [
            {
                "session_id": "session-offline-10a1",
                "room_id": "room-10a1",
                "page_number": 2,
                "canvas_json": {"objects": [], "background": "#ffffff"},
                "recognized_latex": "F = m a",
            }
        ],
    }

    resp = client.post("/api/v1/offline-sync/snapshots", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"
    assert data["synced_count"] == 2
    assert data["duplicate_count"] == 0
    assert data["failed_count"] == 0
    assert data["pages_synced"] == 1
    assert all(item["status"] == "synced" and item["snapshot_id"] for item in data["results"])

    # Kiểm tra trang bảng được đồng bộ và snapshot tra cứu được với cờ offline
    assert "room-10a1:session-offline-10a1" in in_memory_pages
    assert any(s.get("client_sync_id") == sync_id_1 and s.get("synced_from_offline") for s in in_memory_snapshots)

    # Gửi lại cùng client_sync_id khi mạng chập chờn -> trả duplicate, không nhân đôi dữ liệu
    retry_resp = client.post("/api/v1/offline-sync/snapshots", json={"items": [payload["items"][0]]})
    assert retry_resp.status_code == 200
    retry_data = retry_resp.json()
    assert retry_data["synced_count"] == 0
    assert retry_data["duplicate_count"] == 1
    assert retry_data["results"][0]["status"] == "duplicate"


def test_offline_sync_partial_failure_does_not_drop_valid_items():
    valid_id = "offline-sync-valid-003"
    invalid_id = "offline-sync-invalid-004"
    synced_offline_ids.pop(valid_id, None)
    synced_offline_ids.pop(invalid_id, None)

    resp = client.post(
        "/api/v1/offline-sync/snapshots",
        json={
            "items": [
                {
                    "client_sync_id": valid_id,
                    "session_id": "session-offline-partial",
                    "room_id": "room-10a2",
                    "image_base64": make_test_png_b64(),
                },
                {
                    "client_sync_id": invalid_id,
                    "session_id": "session-offline-partial",
                    "room_id": "room-10a2",
                    "image_base64": "not-a-valid-image-base64",
                },
            ]
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "partial"
    assert data["synced_count"] == 1
    assert data["failed_count"] == 1
    assert data["results"][0]["status"] == "synced"
    assert data["results"][1]["status"] == "failed"


def test_offline_mode_frontend_assets_and_toast():
    html = client.get("/").text
    assert 'id="offlineCornerToast"' in html
    assert 'popover="manual"' in html
    assert 'id="offlineSyncBadge"' in html

    css = client.get("/style.css").text
    assert ":is(:popover-open" in css
    assert "prefers-reduced-motion" in css

    offline_js = client.get("/src/utils/offline_sync.js").text
    assert "ai-canvas-offline-db" in offline_js
    assert "pending_snapshots" in offline_js
    assert "/api/v1/offline-sync/snapshots" in offline_js
