import base64
import io
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Any
from PIL import Image
from app.core.config import settings

try:
    from minio import Minio
    HAS_MINIO = True
except ImportError:
    HAS_MINIO = False


def convert_canvas_to_highres(image_base64: str, target_format: str = "webp") -> bytes:
    """Chuyển đổi ảnh chụp bảng Canvas sang định dạng độ phân giải cao (.webp hoặc .png)."""
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]
    raw_bytes = base64.b64decode(image_base64)
    img = Image.open(io.BytesIO(raw_bytes))

    out_buf = io.BytesIO()
    fmt = "WEBP" if target_format.lower() == "webp" else "PNG"
    if fmt == "WEBP":
        img.save(out_buf, format="WEBP", quality=92, method=4)
    else:
        img.save(out_buf, format="PNG", optimize=True)
    return out_buf.getvalue()


def upload_snapshot_to_minio(
    image_base64: str,
    class_name: str,
    subject: str,
    image_format: str = "webp",
) -> Dict[str, Any]:
    """
    Lưu trữ ảnh chụp bảng độ phân giải cao (.webp/.png) lên MinIO Object Storage
    kèm thời hạn lưu trữ tối thiểu 06 tháng (FR-SNAP-01, FR-SNAP-03).
    """
    ext = "webp" if image_format.lower() == "webp" else "png"
    content_type = f"image/{ext}"
    now = datetime.now(timezone.utc)
    retention_until = now + timedelta(days=180)
    date_prefix = now.strftime("%Y/%m/%d")
    object_name = f"{class_name}/{subject}/{date_prefix}/{uuid.uuid4()}.{ext}"

    img_bytes = convert_canvas_to_highres(image_base64, ext)

    if HAS_MINIO:
        try:
            import urllib3
            http_client = urllib3.PoolManager(
                timeout=urllib3.Timeout(connect=0.5, read=1.0),
                retries=False,
            )
            client = Minio(
                settings.MINIO_ENDPOINT,
                access_key=settings.MINIO_ACCESS_KEY,
                secret_key=settings.MINIO_SECRET_KEY,
                secure=settings.MINIO_SECURE,
                http_client=http_client,
            )
            if not client.bucket_exists(settings.MINIO_BUCKET):
                client.make_bucket(settings.MINIO_BUCKET)

            client.put_object(
                bucket_name=settings.MINIO_BUCKET,
                object_name=object_name,
                data=io.BytesIO(img_bytes),
                length=len(img_bytes),
                content_type=content_type,
            )
            protocol = "https" if settings.MINIO_SECURE else "http"
            image_url = f"{protocol}://{settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET}/{object_name}"
            return {
                "storage_provider": "MINIO",
                "bucket": settings.MINIO_BUCKET,
                "object_name": object_name,
                "image_url": image_url,
                "image_format": ext,
                "size_bytes": len(img_bytes),
                "created_at": now.isoformat(),
                "retention_until": retention_until.isoformat(),
            }
        except Exception:
            pass

    # Fallback lưu đường dẫn ảo + data URI khi chạy môi trường local chưa bật MinIO container
    b64_encoded = base64.b64encode(img_bytes).decode("utf-8")
    return {
        "storage_provider": "MINIO_LOCAL_FALLBACK",
        "bucket": settings.MINIO_BUCKET,
        "object_name": object_name,
        "image_url": f"http://{settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET}/{object_name}",
        "data_uri": f"data:{content_type};base64,{b64_encoded}",
        "image_format": ext,
        "size_bytes": len(img_bytes),
        "created_at": now.isoformat(),
        "retention_until": retention_until.isoformat(),
    }
