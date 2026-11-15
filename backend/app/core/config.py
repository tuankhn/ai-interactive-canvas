import os
from pathlib import Path
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

    SECRET_KEY: str = os.getenv("SECRET_KEY", "super_secret_jwt_key_for_development_purposes_only_32bytes")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))
    OTP_EXPIRE_SECONDS: int = int(os.getenv("OTP_EXPIRE_SECONDS", "300"))

    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "noreply@aicanvas.edu.vn")

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
    MATHPIX_APP_ID: str = os.getenv("MATHPIX_APP_ID", "")
    MATHPIX_APP_KEY: str = os.getenv("MATHPIX_APP_KEY", "")

    # Cấu hình tài khoản Admin mặc định (môi trường local/demo) & hạn ngạch AI/MinIO (TF28528)
    ADMIN_EMAIL: str = os.getenv("ADMIN_EMAIL", "admin@aicanvas.edu.vn")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "Admin@2026")
    GEMINI_MONTHLY_QUOTA: int = int(os.getenv("GEMINI_MONTHLY_QUOTA", "10000"))
    MATHPIX_MONTHLY_QUOTA: int = int(os.getenv("MATHPIX_MONTHLY_QUOTA", "5000"))
    MINIO_STORAGE_QUOTA_MB: float = float(os.getenv("MINIO_STORAGE_QUOTA_MB", "5120"))


settings = Settings()
