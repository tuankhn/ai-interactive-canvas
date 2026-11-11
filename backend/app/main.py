import os
from typing import Dict, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.core.config import settings
from app.core.database import check_db_status

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Backend API & WebSocket cho Bảng vẽ thông minh hỗ trợ giảng dạy (AI Interactive Canvas)",
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
    from app.api.session_router import router as session_router
    app.include_router(session_router)
except ImportError:
    pass

try:
    from app.api.auth_router import router as auth_router
    app.include_router(auth_router)
except ImportError:
    pass

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
            for conn in list(active_connections.get(channel_key, [])):
                if conn is not websocket:
                    await conn.send_text(message)
    except WebSocketDisconnect:
        if channel_key in active_connections and websocket in active_connections[channel_key]:
            active_connections[channel_key].remove(websocket)


FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
if os.path.isdir(FRONTEND_DIR) and os.path.isfile(os.path.join(FRONTEND_DIR, "index.html")):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/{file_name:path}", include_in_schema=False)
    async def serve_frontend(file_name: str = ""):
        target_path = os.path.join(FRONTEND_DIR, file_name) if file_name else os.path.join(FRONTEND_DIR, "index.html")
        if os.path.isfile(target_path):
            return FileResponse(target_path)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

