import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# Tự động nạp biến môi trường từ file .env nếu có
_candidate_envs = [
    Path(__file__).resolve().parent.parent.parent / ".env",
    Path(__file__).resolve().parent.parent.parent.parent / ".env",
]
for _env_path in _candidate_envs:
    if _env_path.exists():
        load_dotenv(_env_path, override=True)


class Settings:
    APP_NAME: str = os.getenv("APP_NAME", "AI Interactive Canvas API")
    APP_ENV: str = os.getenv("APP_ENV", "development")
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    CORS_ALLOW_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
        if origin.strip()
    ] or ["*"]

    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://aicanvas:aicanvas_secret@localhost:5432/ai_interactive_canvas",
    )
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY: str = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY: str = os.getenv("MINIO_SECRET_KEY", "minioadmin123")
    MINIO_BUCKET: str = os.getenv("MINIO_BUCKET", "board-snapshots")
    MINIO_SECURE: bool = os.getenv("MINIO_SECURE", "false").lower() == "true"

    SNAPSHOT_DIR: str = os.getenv("SNAPSHOT_DIR", "uploads/snapshots")
    MAX_SNAPSHOT_BASE64_CHARS: int = int(os.getenv("MAX_SNAPSHOT_BASE64_CHARS", str(12 * 1024 * 1024)))

    SECRET_KEY: str = os.getenv("SECRET_KEY", "super_secret_jwt_key_for_development_purposes_only_32bytes")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))
    OTP_EXPIRE_SECONDS: int = int(os.getenv("OTP_EXPIRE_SECONDS", "300"))
    DEV_OTP_BYPASS: bool = os.getenv("DEV_OTP_BYPASS", "false").lower() in ("1", "true", "yes")
    AUTH_ENFORCE: bool = os.getenv("AUTH_ENFORCE", "false").lower() in ("1", "true", "yes", "enforce")

    # Giới hạn tần suất thử đăng nhập & yêu cầu OTP (Đợt 0: N2)
    LOGIN_RATE_LIMIT_ENABLED: bool = os.getenv("LOGIN_RATE_LIMIT_ENABLED", "true").lower() in ("1", "true", "yes")
    LOGIN_MAX_FAILED_ATTEMPTS: int = int(os.getenv("LOGIN_MAX_FAILED_ATTEMPTS", "5"))
    LOGIN_LOCKOUT_BASE_SECONDS: int = int(os.getenv("LOGIN_LOCKOUT_BASE_SECONDS", "30"))
    OTP_REQUEST_COOLDOWN_SECONDS: int = int(os.getenv("OTP_REQUEST_COOLDOWN_SECONDS", "30"))

    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "noreply@aicanvas.edu.vn")

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
    GEMINI_FALLBACK_MODELS: list[str] = [
        model.strip()
        for model in os.getenv(
            "GEMINI_FALLBACK_MODELS",
            "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash",
        ).split(",")
        if model.strip()
    ]
    MATHPIX_APP_ID: str = os.getenv("MATHPIX_APP_ID", "")
    MATHPIX_APP_KEY: str = os.getenv("MATHPIX_APP_KEY", "")

    # Cấu hình tài khoản Admin mặc định (môi trường local/demo) & hạn ngạch AI/MinIO (TF28528)
    ADMIN_EMAIL: str = os.getenv("ADMIN_EMAIL", "admin@aicanvas.edu.vn")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "Admin@2026")
    DEMO_DEFAULT_PASSWORD: str = os.getenv("DEMO_DEFAULT_PASSWORD", "Demo@2026")
    SEED_DEMO_ON_STARTUP: bool = os.getenv("SEED_DEMO_ON_STARTUP", "true").lower() in ("1", "true", "yes")
    GEMINI_MONTHLY_QUOTA: int = int(os.getenv("GEMINI_MONTHLY_QUOTA", "10000"))
    MATHPIX_MONTHLY_QUOTA: int = int(os.getenv("MATHPIX_MONTHLY_QUOTA", "5000"))
    MINIO_STORAGE_QUOTA_MB: float = float(os.getenv("MINIO_STORAGE_QUOTA_MB", "5120"))

    # Giới hạn kích thước kho lưu trữ tạm in-memory tránh rò rỉ bộ nhớ (M7)
    MAX_IN_MEMORY_SNAPSHOTS: int = int(os.getenv("MAX_IN_MEMORY_SNAPSHOTS", "500"))
    MAX_IN_MEMORY_ANSWER_KEYS: int = int(os.getenv("MAX_IN_MEMORY_ANSWER_KEYS", "2000"))
    MAX_IN_MEMORY_LOGS: int = int(os.getenv("MAX_IN_MEMORY_LOGS", "2000"))


_INSECURE_DEFAULT_SECRETS = {
    "SECRET_KEY": "super_secret_jwt_key_for_development_purposes_only_32bytes",
    "ADMIN_PASSWORD": "Admin@2026",
    "MINIO_SECRET_KEY": "minioadmin123",
}


def validate_production_secrets(cfg: Optional["Settings"] = None) -> None:
    """N12: Từ chối khởi động khi APP_ENV='production' mà vẫn để các mật khẩu/khóa mặc định."""
    target = cfg or settings
    if (target.APP_ENV or "").strip().lower() != "production":
        return
    insecure_fields = [
        field_name
        for field_name, default_val in _INSECURE_DEFAULT_SECRETS.items()
        if getattr(target, field_name, None) == default_val or not str(getattr(target, field_name, "")).strip()
    ]
    if insecure_fields:
        raise RuntimeError(
            f"Từ chối khởi động trên môi trường production do chưa thay đổi cấu hình nhạy cảm mặc định: {', '.join(insecure_fields)}"
        )


settings = Settings()
