# ==============================================================================
# MODULE TIỀN XỬ LÝ ẢNH BẢNG VẼ BẰNG OPENCV VÀ PILLOW (TASK TF28506)
# Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# Tối ưu chuyên biệt cho Digital Smartboard Canvas
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

# Kiểm tra thư viện OpenCV
try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    logger.warning("OpenCV chưa được nạp. Đang sử dụng chế độ Pillow tối ưu.")


class ImageProcessingService:
    """
    Dịch vụ tiền xử lý ảnh Canvas kỹ thuật số trên Bảng thông minh (Smartboard):
    1. Nhận ảnh xuất từ Canvas (Base64 string hoặc Binary bytes).
    2. Khử nhiễu, làm mịn nét bút cảm ứng (Stylus smoothing / Bilateral filter).
    3. Tăng cường độ tương phản cho nét chữ viết tay.
    4. Tự động phát hiện Bounding Box của toàn bộ nét vẽ và Cắt sát (Crop) vùng nội dung.
    5. Nén ảnh và giảm dung lượng payload (60-85%) trước khi gửi sang AI Gemini / Mathpix.
    """

    # Màu nền mặc định của Bảng phấn thông minh: #1a2e26 (R:26, G:46, B:38)
    CHALKBOARD_BG_COLOR = (26, 46, 38)

    @staticmethod
    def decode_input_to_image(image_input: Union[str, bytes, Image.Image]) -> Image.Image:
        """Giải mã đa định dạng đầu vào (Base64 Data URL, Bytes, PIL Image) thành PIL.Image"""
        if isinstance(image_input, Image.Image):
            return image_input

        if isinstance(image_input, str):
            if "," in image_input:
                _, image_input = image_input.split(",", 1)
            raw_bytes = base64.b64decode(image_input)
            return Image.open(BytesIO(raw_bytes))

        if isinstance(image_input, bytes):
            return Image.open(BytesIO(image_input))

        raise ValueError("Định dạng ảnh không hợp lệ (hỗ trợ base64 str, bytes hoặc PIL Image)")

    @staticmethod
    def pil_to_cv2(pil_img: Image.Image):
        """Chuyển đổi PIL Image sang mảng NumPy BGR cho OpenCV"""
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
            return Image.fromarray(cv_img)
        rgb_array = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
        return Image.fromarray(rgb_array)

    @staticmethod
    def encode_to_base64(pil_img: Image.Image, format: str = "WEBP", quality: int = 90) -> str:
        """Mã hóa ảnh PIL sang Base64 Data URL tối ưu"""
        buffer = BytesIO()
        try:
            if format.upper() == "WEBP":
                pil_img.save(buffer, format="WEBP", quality=quality)
                mime = "image/webp"
            else:
                pil_img.save(buffer, format="PNG", optimize=True)
                mime = "image/png"
        except Exception:
            pil_img.save(buffer, format="PNG")
            mime = "image/png"

        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:{mime};base64,{encoded}"

    @classmethod
    def denoise_and_enhance(cls, pil_img: Image.Image) -> Image.Image:
        """
        Khử nhiễu hạt và làm rõ biên độ nét bút cảm ứng trên bảng thông minh.
        Sử dụng OpenCV Bilateral Filter + CLAHE nếu có, hoặc Pillow Autocontrast.
        """
        if HAS_OPENCV and HAS_NUMPY:
            cv_img = cls.pil_to_cv2(pil_img)
            gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY) if len(cv_img.shape) == 3 else cv_img

            # Khử nhiễu mịn nhưng giữ sắc cạnh nét chữ
            denoised = cv2.bilateralFilter(gray, d=7, sigmaColor=50, sigmaSpace=50)

            # Cân bằng tương phản thích ứng cục bộ (CLAHE)
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
            enhanced = clahe.apply(denoised)
            return cls.cv2_to_pil(enhanced)
        else:
            gray = pil_img.convert("L")
            smoothed = gray.filter(ImageFilter.SMOOTH_MORE)
            enhanced = ImageOps.autocontrast(smoothed, cutoff=2)
            return enhanced

    @classmethod
    def find_strokes_bounding_box(
        cls,
        pil_img: Image.Image,
        padding: int = 25,
        stroke_threshold: int = 40,
        min_stroke_area: int = 15
    ) -> Tuple[Optional[Tuple[int, int, int, int]], bool]:
        """
        Tìm hộp bao quanh (Bounding Box) chứa toàn bộ các nét vẽ tay trên màn hình Bảng thông minh.
        Trả về: (x, y, w, h), has_strokes (True/False)
        """
        img_w, img_h = pil_img.size

        if HAS_OPENCV and HAS_NUMPY:
            cv_img = cls.pil_to_cv2(pil_img)
            gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY) if len(cv_img.shape) == 3 else cv_img

            # Tách nét vẽ kỹ thuật số ra khỏi nền bảng tối màu
            _, mask = cv2.threshold(gray, stroke_threshold, 255, cv2.THRESH_BINARY)

            # Khử chấm điểm li ti bằng toán tử hình thái học Morphological
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            clean_mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            clean_mask = cv2.morphologyEx(clean_mask, cv2.MORPH_CLOSE, kernel)

            # Tìm đường bao nét vẽ (Contours)
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
            # Fallback với Pillow
            gray = pil_img.convert("L")
            mask = gray.point(lambda p: 255 if p > stroke_threshold else 0)
            bbox = mask.getbbox()
            if not bbox:
                return None, False

            all_x1, all_y1, all_x2, all_y2 = bbox

        # Áp dụng khoảng đệm an toàn (Padding) để nét chữ không bị sát lề
        final_x1 = max(0, all_x1 - padding)
        final_y1 = max(0, all_y1 - padding)
        final_x2 = min(img_w, all_x2 + padding)
        final_y2 = min(img_h, all_y2 + padding)

        crop_w = final_x2 - final_x1
        crop_h = final_y2 - final_y1

        return (final_x1, final_y1, crop_w, crop_h), True

    @classmethod
    def resize_max_dimension(cls, pil_img: Image.Image, max_dim: int = 1280) -> Image.Image:
        """Thu nhỏ ảnh kích thước 4K/FullHD của Smartboard về mức tối ưu cho AI"""
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
        Quy trình tiền xử lý ảnh Canvas trên Smartboard trước khi gửi sang AI:
        1. Nhận dữ liệu ảnh từ Canvas Bảng thông minh.
        2. Tìm Bounding Box của toàn bộ nét vẽ tay trên màn hình.
        3. Cắt sát vùng có chữ (Crop) để loại bỏ phần không gian bảng trống.
        4. Khử nhiễu nét bút và tăng cường độ tương phản.
        5. Chuẩn hóa độ phân giải tối đa và nén ảnh WebP.
        6. Giảm 60-85% dung lượng payload gửi lên API Gemini / Mathpix.
        """
        pil_original = cls.decode_input_to_image(image_input)
        orig_w, orig_h = pil_original.size

        # Đo dung lượng gốc trước xử lý
        orig_buffer = BytesIO()
        pil_original.save(orig_buffer, format="PNG")
        original_size_bytes = len(orig_buffer.getvalue())

        # Tìm tọa độ nét vẽ trên bảng
        bbox, has_strokes = cls.find_strokes_bounding_box(
            pil_original, padding=padding
        )

        if has_strokes and bbox:
            x, y, w, h = bbox
            # Cắt sát vùng có nét chữ
            cropped_img = pil_original.crop((x, y, x + w, y + h))
            # Khử nhiễu và tăng tương phản
            enhanced_img = cls.denoise_and_enhance(cropped_img)
            if enhanced_img.mode != "RGB":
                enhanced_img = enhanced_img.convert("RGB")
            # Chuẩn hóa độ phân giải
            final_img = cls.resize_max_dimension(enhanced_img, max_dim=max_dim)
            bounding_box_result = list(bbox)
        else:
            # Bảng trống không có nét vẽ
            final_img = cls.resize_max_dimension(pil_original, max_dim=max_dim)
            bounding_box_result = [0, 0, orig_w, orig_h]
            has_strokes = False

        # Nén ảnh sau xử lý
        processed_base64 = cls.encode_to_base64(final_img, format=output_format)
        processed_size_bytes = len(base64.b64decode(processed_base64.split(",")[1]))

        compression_ratio = round(
            (1.0 - (processed_size_bytes / max(1, original_size_bytes))) * 100, 2
        )

        return {
            "processed_base64": processed_base64,
            "has_strokes": has_strokes,
            "bounding_box": bounding_box_result,  # [x, y, width, height]
            "original_dimensions": [orig_w, orig_h],
            "processed_dimensions": list(final_img.size),
            "original_size_kb": round(original_size_bytes / 1024, 2),
            "processed_size_kb": round(processed_size_bytes / 1024, 2),
            "compression_ratio_percent": compression_ratio,
        }


image_processing_service = ImageProcessingService()
