from contextlib import asynccontextmanager
import json
import os
from typing import Dict, List
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.core.config import settings
from app.core.database import check_db_status, record_ai_usage_event


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Tự động nạp sẵn tài khoản lớp học & bộ đề mẫu Demo khi khởi chạy máy chủ / Docker (TF28524)."""
    if settings.SEED_DEMO_ON_STARTUP:
        try:
            from app.core.demo_seed import seed_demo_environment
            seed_demo_environment(force=False)
        except Exception:
            pass
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Backend API & WebSocket cho Bảng vẽ thông minh hỗ trợ giảng dạy (AI Interactive Canvas)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tự động gắn các router nghiệp vụ khi các module tương ứng được thêm vào
try:
    from app.api.recognize_router import router as recognize_router
    app.include_router(recognize_router)
except ImportError:
    pass

try:
    from app.api.session_router import router as session_router, alias_router as session_alias_router
    app.include_router(session_router)
    app.include_router(session_alias_router)
except ImportError:
    pass

try:
    from app.api.auth_router import router as auth_router
    app.include_router(auth_router)
except ImportError:
    pass

try:
    from app.api.offline_sync_router import router as offline_sync_router
    app.include_router(offline_sync_router)
except ImportError:
    pass

try:
    from app.api.admin_router import router as admin_router
    app.include_router(admin_router)
except ImportError:
    pass

try:
    from app.api.exam_router import router as exam_router, alias_router as exam_alias_router
    app.include_router(exam_router)
    app.include_router(exam_alias_router)
except ImportError:
    pass

try:
    from app.api.score_router import router as score_router
    app.include_router(score_router)
except ImportError:
    pass

try:
    from app.api.benchmark_router import router as benchmark_router
    app.include_router(benchmark_router)
except ImportError:
    pass

try:
    from app.api.demo_router import router as demo_router
    app.include_router(demo_router)
except ImportError:
    pass


_AI_TRACKED_PATHS = {
    "/api/v1/recognize": "OCR_LATEX",
    "/api/v1/canvas/recognize": "OCR_LATEX",
    "/api/v1/illustrate": "VOCAB_IMAGE",
    "/api/v1/canvas/illustrate": "VOCAB_IMAGE",
}


@app.middleware("http")
async def track_ai_quota_middleware(request: Request, call_next):
    """Tự động ghi nhận số lượt gọi API Gemini / Mathpix cho trang Admin mà không sửa file module AI."""
    response = await call_next(request)
    task_type = _AI_TRACKED_PATHS.get(request.url.path)
    if request.method == "POST" and task_type and response.status_code < 400:
        try:
            chunks = [chunk async for chunk in response.body_iterator]
            raw_body = b"".join(chunks)
        except Exception:
            return response

        try:
            data = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            has_live_gemini = bool((settings.GEMINI_API_KEY or "").strip())
            default_provider = (
                ("chalkboard-gemini" if has_live_gemini else "chalkboard-mock")
                if task_type == "VOCAB_IMAGE"
                else "gemini"
            )
            provider_raw = str(data.get("provider") or default_provider)
            is_mock = ("mock" in provider_raw.lower()) or (
                task_type == "VOCAB_IMAGE" and not has_live_gemini
            )
            record_ai_usage_event(
                provider="MATHPIX" if "mathpix" in provider_raw.lower() else "GEMINI",
                provider_detail=provider_raw,
                task_type=task_type,
                subject=str(data.get("subject") or ("TIENG_ANH" if task_type == "VOCAB_IMAGE" else "TOAN")),
                latency_ms=int(data.get("latency_ms") or 0),
                is_mock=is_mock,
                estimated_tokens=300 if task_type == "OCR_LATEX" else 450,
                session_id=data.get("session_id"),
                room_id=data.get("room_id"),
            )
        except Exception:
            pass

        return Response(
            content=raw_body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )
    return response

active_connections: Dict[str, List[WebSocket]] = {}


@app.get("/health", tags=["System Health"])
@app.get("/api/v1/health", tags=["System Health"])
async def health_check():
    """Kiểm tra trạng thái hoạt động của FastAPI, PostgreSQL 16+, Redis 7+ và MinIO."""
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": "1.0.0",
        "infrastructure": check_db_status(),
    }


@app.websocket("/ws/board/{room_id}/{session_id}")
async def board_websocket(websocket: WebSocket, room_id: str, session_id: str):
    """Kênh WebSocket (WSS) đồng bộ bảng vẽ thời gian thực cô lập theo room_id và session_id."""
    await websocket.accept()
    channel_key = f"{room_id}:{session_id}"
    if channel_key not in active_connections:
        active_connections[channel_key] = []
    active_connections[channel_key].append(websocket)

    try:
        while True:
            message = await websocket.receive_text()
            dead_connections = []
            for conn in list(active_connections.get(channel_key, [])):
                if conn is not websocket:
                    try:
                        await conn.send_text(message)
                    except Exception:
                        dead_connections.append(conn)
            for dead in dead_connections:
                if channel_key in active_connections and dead in active_connections[channel_key]:
                    active_connections[channel_key].remove(dead)
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if channel_key in active_connections and websocket in active_connections[channel_key]:
            active_connections[channel_key].remove(websocket)
        if channel_key in active_connections and not active_connections[channel_key]:
            active_connections.pop(channel_key, None)


FRONTEND_DIR = os.path.abspath(
    os.getenv("FRONTEND_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
)
if os.path.isdir(FRONTEND_DIR) and os.path.isfile(os.path.join(FRONTEND_DIR, "index.html")):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/{file_name:path}", include_in_schema=False)
    async def serve_frontend(file_name: str = ""):
        clean_path = file_name.strip("/")
        if clean_path.startswith("api") or clean_path.startswith("ws"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail=f"API endpoint '/{clean_path}' không tồn tại.")

        target_path = os.path.join(FRONTEND_DIR, file_name) if file_name else os.path.join(FRONTEND_DIR, "index.html")
        if os.path.isfile(target_path):
            return FileResponse(target_path)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

