import base64
import io
from typing import Dict, Any, Tuple
from PIL import Image, ImageOps, ImageFilter, ImageEnhance

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False


def decode_base64_image(image_base64: str) -> Tuple[Image.Image, int]:
    """Giải mã chuỗi ảnh Base64 từ Canvas sang đối tượng PIL Image."""
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]
    raw_bytes = base64.b64decode(image_base64)
    img = Image.open(io.BytesIO(raw_bytes))
    return img, len(raw_bytes)


def preprocess_canvas_image(image_base64: str, padding: int = 18) -> Dict[str, Any]:
    """
    Sprint 1 - Task 6: Tiền xử lý ảnh vùng vẽ bằng OpenCV và Pillow trước khi gửi AI.
    Các bước:
      1. Chuyển ảnh RGBA/RGB sang ảnh xám (Grayscale), tự động đảo màu nếu đang vẽ phấn trắng trên nền bảng đen.
      2. Khử nhiễu (Gaussian / Median blur) và tăng độ tương phản nét viết.
      3. Tìm hộp giới hạn (Bounding Box) ôm sát vùng có nét bút để cắt bỏ khoảng trống thừa.
      4. Xuất lại ảnh PNG nén nhẹ dạng Base64 để gửi sang Gemini 2.5 Flash / Mathpix.
    """
    img, raw_len = decode_base64_image(image_base64)

    # Xử lý kênh trong suốt (nếu Canvas gửi ảnh PNG nền trong suốt)
    if img.mode == "RGBA":
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        composed = Image.alpha_composite(bg, img).convert("RGB")
    else:
        composed = img.convert("RGB")

    orig_w, orig_h = composed.size
    gray = ImageOps.grayscale(composed)

    # Kiểm tra nền tối (bảng đen phấn trắng) dựa vào độ sáng trung bình
    hist = gray.histogram()
    total_px = max(orig_w * orig_h, 1)
    mean_lum = sum(i * count for i, count in enumerate(hist)) / total_px
    if mean_lum < 128:
        # Đảo ngược thành nền trắng - nét chữ đen để OCR/AI đọc chuẩn nhất
        gray = ImageOps.invert(gray)

    if HAS_OPENCV:
        arr = np.array(gray)
        # Khử nhiễu nhẹ bằng GaussianBlur + Adaptive Threshold
        blurred = cv2.GaussianBlur(arr, (3, 3), 0)
        binary = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 8
        )
        coords = cv2.findNonZero(binary)
        if coords is not None:
            x, y, w, h = cv2.boundingRect(coords)
            x0 = max(0, x - padding)
            y0 = max(0, y - padding)
            x1 = min(orig_w, x + w + padding)
            y1 = min(orig_h, y + h + padding)
        else:
            x0, y0, x1, y1 = 0, 0, orig_w, orig_h

        # Tạo ảnh nền trắng chữ đen rõ nét
        clean_arr = 255 - binary[y0:y1, x0:x1]
        cropped_img = Image.fromarray(clean_arr)
    else:
        # Fallback thuần Pillow khi môi trường chưa cài gói opencv
        denoised = gray.filter(ImageFilter.MedianFilter(size=3))
        enhanced = ImageEnhance.Contrast(denoised).enhance(2.2)
        inverted = ImageOps.invert(enhanced)
        # Ngưỡng nhị phân lọc nét viết
        mask = inverted.point(lambda p: 255 if p > 35 else 0)
        bbox = mask.getbbox()
        if bbox:
            x0 = max(0, bbox[0] - padding)
            y0 = max(0, bbox[1] - padding)
            x1 = min(orig_w, bbox[2] + padding)
            y1 = min(orig_h, bbox[3] + padding)
        else:
            x0, y0, x1, y1 = 0, 0, orig_w, orig_h

        cropped_img = enhanced.crop((x0, y0, x1, y1))

    out_buf = io.BytesIO()
    cropped_img.save(out_buf, format="PNG", optimize=True)
    processed_bytes = out_buf.getvalue()
    processed_b64 = base64.b64encode(processed_bytes).decode("utf-8")

    reduction = 0.0
    if raw_len > 0 and len(processed_bytes) < raw_len:
        reduction = round((1.0 - len(processed_bytes) / raw_len) * 100, 1)

    return {
        "original_size": [orig_w, orig_h],
        "cropped_size": [cropped_img.width, cropped_img.height],
        "bounding_box": {
            "x": int(x0),
            "y": int(y0),
            "width": int(x1 - x0),
            "height": int(y1 - y0),
        },
        "processed_base64": f"data:image/png;base64,{processed_b64}",
        "raw_base64": processed_b64,
        "size_reduction_percent": reduction,
    }
