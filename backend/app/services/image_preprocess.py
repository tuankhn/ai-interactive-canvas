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


def _composite_rgba_preserving_strokes(img: Image.Image) -> Image.Image:
    """
    Hợp nhất kênh Alpha thông minh (chạy C-level histogram cực nhanh, hỗ trợ cả khi có hoặc không có OpenCV):
    - Nếu người dùng vẽ bút phấn trắng/vàng/xanh sáng trên nền Canvas trong suốt (RGBA),
      tự động đặt lên nền tối (17, 24, 39) để không bị mất nét trắng trên nền trắng.
    - Ngược lại đặt lên nền trắng chuẩn (255, 255, 255).
    """
    if img.mode not in ("RGBA", "LA"):
        return img.convert("RGB")

    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    alpha_hist = alpha.histogram()
    total_px = max(rgba.width * rgba.height, 1)
    transparent_ratio = sum(alpha_hist[:16]) / total_px
    opaque_count = sum(alpha_hist[33:])

    if opaque_count > 0 and transparent_ratio > 0.15:
        gray_rgb = ImageOps.grayscale(rgba.convert("RGB"))
        opaque_mask = alpha.point(lambda a: 255 if a > 32 else 0, mode="L")
        lum_hist = gray_rgb.histogram(opaque_mask)
        mask_total = sum(lum_hist)
        if mask_total > 0:
            mean_lum = sum(i * c for i, c in enumerate(lum_hist)) / mask_total
            if mean_lum > 180.0:
                dark_bg = Image.new("RGBA", rgba.size, (17, 24, 39, 255))
                return Image.alpha_composite(dark_bg, rgba).convert("RGB")

    white_bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(white_bg, rgba).convert("RGB")


def preprocess_canvas_image(image_base64: str, padding: int = 22) -> Dict[str, Any]:
    """
    Sprint 1 - Task 6: Tiền xử lý ảnh vùng vẽ bằng OpenCV và Pillow trước khi gửi AI.
    Các bước:
      1. Hợp nhất kênh RGBA bảo toàn cả nét mực tối lẫn nét phấn sáng, chuẩn hóa thành chữ đậm trên nền trắng.
      2. Tìm hộp giới hạn (Bounding Box) ôm sát vùng có nét bút (dựa trên độ lệch so với màu nền) mà KHÔNG
         dùng adaptiveThreshold khối nhỏ làm rỗng ruột nét bút dày.
      3. Giữ nguyên biên dạng mượt (anti-aliased) và ruột nét đặc để Gemini Vision / Mathpix đọc chuẩn xác nhất.
    """
    img, raw_len = decode_base64_image(image_base64)
    composed = _composite_rgba_preserving_strokes(img)

    orig_w, orig_h = composed.size
    gray = ImageOps.grayscale(composed)

    # Kiểm tra nền tối (bảng đen phấn trắng) dựa vào độ sáng trung bình
    hist = gray.histogram()
    total_px = max(orig_w * orig_h, 1)
    mean_lum = sum(i * count for i, count in enumerate(hist)) / total_px
    if mean_lum < 128:
        # Đảo ngược thành nền sáng - nét chữ đậm để OCR/AI đọc chuẩn nhất
        gray = ImageOps.invert(gray)

    if HAS_OPENCV:
        arr = np.array(gray)
        # Ước lượng độ sáng nền từ trung vị ảnh (trên bảng vẽ, nền chiếm đa số diện tích)
        bg_val = int(np.median(arr))
        diff = cv2.absdiff(arr, bg_val)

        # Tạo mặt nạ nhị phân chỉ để tìm Bounding Box (ngưỡng 20 bắt được cả nét bút màu nhạt)
        _, stroke_mask = cv2.threshold(diff, 20, 255, cv2.THRESH_BINARY)
        if orig_w > 32 and orig_h > 32:
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
            stroke_mask = cv2.morphologyEx(stroke_mask, cv2.MORPH_OPEN, kernel)

        coords = cv2.findNonZero(stroke_mask)
        if coords is not None:
            x, y, w, h = cv2.boundingRect(coords)
            x0 = max(0, x - padding)
            y0 = max(0, y - padding)
            x1 = min(orig_w, x + w + padding)
            y1 = min(orig_h, y + h + padding)
        else:
            x0, y0, x1, y1 = 0, 0, orig_w, orig_h

        crop_arr = arr[y0:y1, x0:x1].astype(np.float32)
        # Làm sạch nền về trắng tinh (255) nhưng giữ nguyên độ đậm đặc và khử răng cưa của ruột nét bút
        if bg_val > 140:
            scale = 255.0 / max(float(bg_val), 180.0)
            normalized = np.clip(crop_arr * scale, 0, 255)
            # Tăng độ đậm nét viết nhẹ để nét màu sáng (đỏ, xanh lơ, cam) rõ ràng hơn
            normalized = np.where(normalized < 242, np.clip((normalized - 242) * 1.35 + 242, 0, 255), 255)
            clean_arr = normalized.astype(np.uint8)
        else:
            clean_arr = crop_arr.astype(np.uint8)

        cropped_img = Image.fromarray(clean_arr)
    else:
        # Fallback thuần Pillow khi môi trường chưa cài gói opencv
        denoised = gray.filter(ImageFilter.MedianFilter(size=3))
        enhanced = ImageEnhance.Contrast(denoised).enhance(1.8)
        inverted = ImageOps.invert(enhanced)
        mask = inverted.point(lambda p: 255 if p > 24 else 0)
        bbox = mask.getbbox()
        if bbox:
            x0 = max(0, bbox[0] - padding)
            y0 = max(0, bbox[1] - padding)
            x1 = min(orig_w, bbox[2] + padding)
            y1 = min(orig_h, bbox[3] + padding)
        else:
            x0, y0, x1, y1 = 0, 0, orig_w, orig_h

        cropped_img = enhanced.crop((x0, y0, x1, y1))

    # Giới hạn cạnh lớn nhất 1024px và nén WebP nhẹ để tăng tốc độ gửi Gemini < 1s
    max_side = max(cropped_img.width, cropped_img.height)
    if max_side > 1024:
        ratio = 1024.0 / max_side
        new_size = (max(1, int(cropped_img.width * ratio)), max(1, int(cropped_img.height * ratio)))
        cropped_img = cropped_img.resize(new_size, Image.Resampling.LANCZOS)

    out_buf = io.BytesIO()
    cropped_img.save(out_buf, format="WEBP", quality=85, method=2)
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
        "processed_base64": f"data:image/webp;base64,{processed_b64}",
        "raw_base64": processed_b64,
        "size_reduction_percent": reduction,
    }
