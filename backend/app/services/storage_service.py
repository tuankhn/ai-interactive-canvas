import base64
import os
import uuid
from io import BytesIO
from PIL import Image
from app.core.config import settings


class StorageService:
    """
    Xử lý lưu trữ Snapshot bảng học và tệp tin đa phương tiện
    Phụ trách: Nguyễn Tuấn Khang (Leader / Fullstack)
    """

    @staticmethod
    def save_board_snapshot(image_base64: str, folder: str = settings.SNAPSHOT_DIR) -> str:
        """Lưu ảnh chụp bảng chất lượng cao định dạng WebP"""
        os.makedirs(folder, exist_ok=True)

        if "," in image_base64:
            _, image_base64 = image_base64.split(",", 1)

        raw_data = base64.b64decode(image_base64)
        img = Image.open(BytesIO(raw_data))

        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        file_id = f"snap_{uuid.uuid4().hex[:12]}.webp"
        target_path = os.path.join(folder, file_id)

        # Lưu WebP với nén tối ưu (chất lượng 88%)
        img.save(target_path, "WEBP", quality=88)

        return f"/uploads/snapshots/{file_id}"


storage_service = StorageService()
