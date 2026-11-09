# ==============================================================================
# MODULE TIỀN XỬ LÝ ẢNH BẢNG VẼ BẰNG OPENCV VÀ PILLOW (TASK TF28506)
# Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import base64
import logging
from io import BytesIO
from typing import Dict, Any, Optional, Tuple, Union
from PIL import Image, ImageOps, ImageFilter

logger = logging.getLogger(__name__)

# Kiểm tra thư viện NumPy
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
    logger.warning("NumPy chưa được cài đặt trong môi trường hiện tại.")

# Kiểm tra thư viện OpenCV
try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    logger.warning("OpenCV chưa được cài đặt. Hệ thống sẽ sử dụng Pillow thuần túy làm fallback.")


class ImageProcessingService:
    """
    Dịch vụ tiền xử lý ảnh bảng vẽ trước khi gửi sang các mô hình AI (Gemini 2.5 Flash, Mathpix):
    1. Tiếp nhận ảnh Canvas (Base64 string hoặc Binary bytes).
    2. Khử nhiễu (Denoising & Bilateral filter / Smoothing).
    3. Tăng cường độ tương phản (Contrast Enhancement / CLAHE / Autocontrast).
    4. Nhận diện vùng nét vẽ (Contours / Bounding Box) và cắt sát (Crop).
    5. Nén và giảm kích thước payload, tiết kiệm token và tăng tốc độ xử lý AI.
    """

    @staticmethod
    def decode_input_to_image(image_input: Union[str, bytes, Image.Image]) -> Image.Image:
        """Giải mã đa định dạng đầu vào (Base64, Bytes, PIL Image) thành PIL.Image"""
        if isinstance(image_input, Image.Image):
            return image_input

        if isinstance(image_input, str):
            if "," in image_input:
                _, image_input = image_input.split(",", 1)
            raw_bytes = base64.b64decode(image_input)
            return Image.open(BytesIO(raw_bytes))

        if isinstance(image_input, bytes):
            return Image.open(BytesIO(image_input))

        raise ValueError("Định dạng dữ liệu ảnh không hợp lệ (hỗ trợ base64 str, bytes hoặc PIL Image)")

    @staticmethod
    def pil_to_cv2(pil_img: Image.Image):
        """Chuyển đổi PIL Image sang mảng NumPy BGR (OpenCV format)"""
        if not HAS_NUMPY or not HAS_OPENCV:
            return None
        if pil_img.mode != "RGB":
            pil_img = pil_img.convert("RGB")
        rgb_array = np.array(pil_img)
        return cv2.cvtColor(rgb_array, cv2.COLOR_RGB2BGR)

    @staticmethod
    def cv2_to_pil(cv_img) -> Image.Image:
        """Chuyển đổi mảng NumPy BGR sang PIL Image"""
        if not HAS_NUMPY or not HAS_OPENCV:
            return cv_img
        if len(cv_img.shape) == 2:
            return Image.fromarray(cv_img)  # Grayscale
        rgb_array = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
        return Image.fromarray(rgb_array)

    @staticmethod
    def encode_to_base64(pil_img: Image.Image, format: str = "WEBP", quality: int = 90) -> str:
        """Mã hóa ảnh PIL sang Base64 Data URL (mặc định nén WebP)"""
        buffer = BytesIO()
        try:
            if format.upper() == "WEBP":
                pil_img.save(buffer, format="WEBP", quality=quality)
                mime = "image/webp"
            else:
                pil_img.save(buffer, format="PNG", optimize=True)
                mime = "image/png"
        except Exception:
            # Fallback sang PNG nếu môi trường chưa hỗ trợ WebP codec
            pil_img.save(buffer, format="PNG")
            mime = "image/png"

        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:{mime};base64,{encoded}"

    @classmethod
    def detect_background_type(cls, img_input: Union[Image.Image, Any]) -> str:
        """
        Tự động nhận diện loại bảng dựa trên độ sáng pixel trung bình:
        - DARK_BOARD: Bảng đen / Bảng xanh phấn trắng (mean brightness < 128)
        - LIGHT_BOARD: Bảng trắng viết bút dạ (mean brightness >= 128)
        """
        if HAS_NUMPY and isinstance(img_input, np.ndarray):
            if HAS_OPENCV:
                gray = cv2.cvtColor(img_input, cv2.COLOR_BGR2GRAY) if len(img_input.shape) == 3 else img_input
            else:
                gray = img_input if len(img_input.shape) == 2 else img_input[:, :, 0]
            h, w = gray.shape[:2]
            corners = [
                gray[0:min(20, h), 0:min(20, w)],
                gray[0:min(20, h), max(0, w - 20):w],
                gray[max(0, h - 20):h, 0:min(20, w)],
                gray[max(0, h - 20):h, max(0, w - 20):w],
            ]
            avg_brightness = np.mean([np.mean(c) for c in corners if c.size > 0])
            return "DARK_BOARD" if avg_brightness < 128 else "LIGHT_BOARD"
        else:
            gray = img_input.convert("L")
            w, h = gray.size
            corners = [
                gray.crop((0, 0, min(20, w), min(20, h))),
                gray.crop((max(0, w - 20), 0, w, min(20, h))),
                gray.crop((0, max(0, h - 20), min(20, w), h)),
                gray.crop((max(0, w - 20), max(0, h - 20), w, h)),
            ]
            avg_brightness = sum(
                sum(c.getdata()) / max(1, len(c.getdata())) for c in corners
            ) / 4.0
            return "DARK_BOARD" if avg_brightness < 128 else "LIGHT_BOARD"


    @classmethod
    def denoise_and_enhance(cls, pil_img: Image.Image, bg_type: str = "DARK_BOARD") -> Image.Image:
        """
        Khử nhiễu và tăng cường độ tương phản nét chữ.
        Sử dụng OpenCV (Bilateral Filter + CLAHE) nếu có, fallback bằng Pillow (Smooth + Autocontrast).
        """
        if HAS_OPENCV and HAS_NUMPY:
            cv_img = cls.pil_to_cv2(pil_img)
            gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY) if len(cv_img.shape) == 3 else cv_img

            # Khử nhiễu mịn nhưng giữ nguyên biên nét chữ
            denoised = cv2.bilateralFilter(gray, d=7, sigmaColor=50, sigmaSpace=50)

            # Cân bằng tương phản cục bộ (CLAHE)
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
            enhanced = clahe.apply(denoised)
            return cls.cv2_to_pil(enhanced)
        else:
            # Pillow Fallback
            gray = pil_img.convert("L")
            smoothed = gray.filter(ImageFilter.SMOOTH_MORE)
            enhanced = ImageOps.autocontrast(smoothed, cutoff=2)
            return enhanced

    @classmethod
    def find_strokes_bounding_box(
        cls,
        pil_img: Image.Image,
        bg_type: str = "DARK_BOARD",
        padding: int = 25,
        min_stroke_area: int = 15
    ) -> Tuple[Optional[Tuple[int, int, int, int]], bool]:
        """
        Tìm hộp bao quanh (Bounding Box) chứa toàn bộ các nét chữ viết tay:
        Trả về: (x, y, w, h), has_strokes (True/False)
        """
        img_w, img_h = pil_img.size

        if HAS_OPENCV and HAS_NUMPY:
            cv_img = cls.pil_to_cv2(pil_img)
            gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY) if len(cv_img.shape) == 3 else cv_img

            if bg_type == "DARK_BOARD":
                _, mask = cv2.threshold(gray, 55, 255, cv2.THRESH_BINARY)
            else:
                _, mask = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            clean_mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            clean_mask = cv2.morphologyEx(clean_mask, cv2.MORPH_CLOSE, kernel)

            contours, _ = cv2.findContours(clean_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            valid_boxes = []
            for c in contours:
                if cv2.contourArea(c) >= min_stroke_area:
                    x, y, w, h = cv2.boundingRect(c)
                    valid_boxes.append((x, y, x + w, y + h))

            if not valid_boxes:
                return None, False

            all_x1 = min(b[0] for b in valid_boxes)
            all_y1 = min(b[1] for b in valid_boxes)
            all_x2 = max(b[2] for b in valid_boxes)
            all_y2 = max(b[3] for b in valid_boxes)
        else:
            # Pillow Fallback
            gray = pil_img.convert("L")
            if bg_type == "DARK_BOARD":
                mask = gray.point(lambda p: 255 if p > 55 else 0)
            else:
                mask = gray.point(lambda p: 255 if p < 200 else 0)

            bbox = mask.getbbox()
            if not bbox:
                return None, False

            all_x1, all_y1, all_x2, all_y2 = bbox

        # Thêm padding an toàn
        final_x1 = max(0, all_x1 - padding)
        final_y1 = max(0, all_y1 - padding)
        final_x2 = min(img_w, all_x2 + padding)
        final_y2 = min(img_h, all_y2 + padding)

        crop_w = final_x2 - final_x1
        crop_h = final_y2 - final_y1

        return (final_x1, final_y1, crop_w, crop_h), True

    @classmethod
    def resize_max_dimension(cls, pil_img: Image.Image, max_dim: int = 1280) -> Image.Image:
        """Thu nhỏ ảnh nếu kích thước vượt quá max_dim, giữ nguyên tỷ lệ khung hình"""
        w, h = pil_img.size
        if max(w, h) <= max_dim:
            return pil_img

        if w > h:
            new_w = max_dim
            new_h = int(h * (max_dim / w))
        else:
            new_h = max_dim
            new_w = int(w * (max_dim / h))

        return pil_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    @classmethod
    def preprocess_for_ai(
        cls,
        image_input: Union[str, bytes, Image.Image],
        padding: int = 25,
        max_dim: int = 1280,
        output_format: str = "WEBP"
    ) -> Dict[str, Any]:
        """
        Quy trình tiền xử lý toàn diện (Pipeline hoàn chỉnh):
        1. Giải mã dữ liệu và đo dung lượng ban đầu.
        2. Tự động nhận diện loại bảng (Dark / Light board).
        3. Khử nhiễu và tăng cường độ tương phản nét chữ.
        4. Tìm Bounding Box của nét chữ và cắt sát vùng vẽ.
        5. Tối ưu kích thước độ phân giải (Resize) và nén ảnh (WebP/PNG).
        6. Trả về ảnh đã xử lý kèm thông số tối ưu (% giảm dung lượng).
        """
        pil_original = cls.decode_input_to_image(image_input)
        orig_w, orig_h = pil_original.size

        # Đo dung lượng gốc
        orig_buffer = BytesIO()
        pil_original.save(orig_buffer, format="PNG")
        original_size_bytes = len(orig_buffer.getvalue())

        # 1. Nhận diện nền bảng
        bg_type = cls.detect_background_type(pil_original)

        # 2. Tìm vùng nét chữ (Bounding Box)
        bbox, has_strokes = cls.find_strokes_bounding_box(
            pil_original, bg_type=bg_type, padding=padding
        )

        if has_strokes and bbox:
            x, y, w, h = bbox
            # 3. Cắt sát vùng có nét chữ
            cropped_img = pil_original.crop((x, y, x + w, y + h))
            # 4. Khử nhiễu và tăng tương phản
            enhanced_img = cls.denoise_and_enhance(cropped_img, bg_type=bg_type)
            # 5. Đổi về RGB 3 kênh
            if enhanced_img.mode != "RGB":
                enhanced_img = enhanced_img.convert("RGB")
            # 6. Chuẩn hóa độ phân giải tối đa
            final_img = cls.resize_max_dimension(enhanced_img, max_dim=max_dim)
            bounding_box_result = list(bbox)
        else:
            final_img = cls.resize_max_dimension(pil_original, max_dim=max_dim)
            bounding_box_result = [0, 0, orig_w, orig_h]
            has_strokes = False

        # 7. Nén và mã hóa Base64
        processed_base64 = cls.encode_to_base64(final_img, format=output_format)
        processed_size_bytes = len(base64.b64decode(processed_base64.split(",")[1]))

        compression_ratio = round(
            (1.0 - (processed_size_bytes / max(1, original_size_bytes))) * 100, 2
        )

        return {
            "processed_base64": processed_base64,
            "has_strokes": has_strokes,
            "bounding_box": bounding_box_result,  # [x, y, width, height]
            "background_type": bg_type,
            "original_dimensions": [orig_w, orig_h],
            "processed_dimensions": list(final_img.size),
            "original_size_kb": round(original_size_bytes / 1024, 2),
            "processed_size_kb": round(processed_size_bytes / 1024, 2),
            "compression_ratio_percent": compression_ratio,
        }


image_processing_service = ImageProcessingService()
