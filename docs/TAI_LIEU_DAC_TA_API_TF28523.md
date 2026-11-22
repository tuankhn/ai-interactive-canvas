# TÀI LIỆU ĐẶC TẢ API (API SPECIFICATION DOCUMENT)
## HỆ THỐNG BẢNG HỌC TƯƠNG TÁC THÔNG MINH (AI INTERACTIVE CANVAS)
**Mã Task:** TF28523 | **Sprint:** Sprint 4 (23/11 – 27/11/2026) | **Hạn nộp:** 24/11/2026  
**Người thực hiện:** Nguyễn Ngọc Gia Bảo 2 (N25DTCN121)  
**Tiêu chuẩn đặc tả:** OpenAPI 3.1.0 / Swagger 2.0  
**Tập tin đính kèm:** `docs/openapi_spec_tf28523.json` và `docs/openapi_spec_tf28523.yaml`

---

## 1. TỔNG QUAN HỆ THỐNG VÀ KIẾN TRÚC API

### 1.1. Giới thiệu
Hệ thống **AI Interactive Canvas API** cung cấp nền tảng giao tiếp RESTful và WebSocket hai chiều phục vụ màn hình tương tác giảng dạy All-in-one tại các lớp học thông minh. Hệ thống hỗ trợ xử lý nét vẽ cảm ứng thời gian thực, bóc tách công thức Toán - Lý - Hóa bằng AI (Gemini 2.5 Flash / Mathpix OCR), tự động dựng đồ thị hàm số 2D/3D, bóc tách đề thi, nhận diện nét khoanh trắc nghiệm, chấm tự luận từng bước viết tay, và cơ chế đồng bộ ngoại tuyến (Offline Sync).

### 1.2. Thông tin môi trường triển khai (Environments)
| Môi trường | Base URL | Mô tả |
|:---|:---|:---|
| **Local Development** | `http://127.0.0.1:8000` | Môi trường phát triển và kiểm thử nội bộ |
| **Interactive Docs (Swagger UI)** | `http://127.0.0.1:8000/docs` | Giao diện thử nghiệm API trực tiếp (Swagger UI) |
| **ReDoc Documentation** | `http://127.0.0.1:8000/redoc` | Tài liệu giao diện ReDoc chuyên nghiệp |
| **OpenAPI Raw Spec** | `http://127.0.0.1:8000/openapi.json` | Schema dữ liệu chuẩn OpenAPI 3.1.0 JSON |

### 1.3. Chuẩn xác thực và Phân quyền (Authentication & Authorization)
Hệ thống áp dụng cơ chế xác thực **JSON Web Token (JWT)** chuẩn RFC 7519:
- **Header truyền Token:** `Authorization: Bearer <access_token>`
- **Thuật toán ký:** `HS256` (HMAC-SHA256) với Secret Key bảo mật.
- **Thời hạn Token (TTL):**
  - **Giáo viên (Teacher Session):** Hỗ trợ duy trì phiên đăng nhập **14 ngày** (`remember_days=14`) khi xác thực qua mã OTP Email.
  - **Học sinh / Phụ huynh (Student/Parent):** Token có hiệu lực 24 giờ.
- **Vai trò người dùng (Roles):**
  - `TEACHER`: Giáo viên giảng dạy (toàn quyền quản lý phòng học, xóa trang, cho điểm, tải đề).
  - `STUDENT`: Học sinh (xem bài giảng, xem điểm thưởng, nộp bài khoanh, chỉ truy cập lớp được phân công).
  - `PARENT`: Phụ huynh (xem bảng điểm và snapshot bài làm của con em).
  - `ADMIN`: Quản trị viên nhà trường (theo dõi quota gọi AI Gemini/Mathpix, quản lý danh sách lớp học).

---

## 2. BẢNG DANH MỤC CÁC ENDPOINT THEO ROUTER NGHIỆP VỤ

| Nhóm chức năng | Phương thức | Đường dẫn Endpoint | Mô tả tóm tắt |
|:---|:---:|:---|:---|
| **1. AI Recognition & Illustration** | `POST` | `/api/v1/recognize` | Nhận diện nét vẽ công thức (Toán, Lý, Hóa, Anh) |
| | `POST` | `/api/v1/canvas/recognize` | Alias nhận diện nét vẽ từ bảng Fabric.js |
| | `POST` | `/api/v1/illustrate` | Tạo hình vẽ minh họa nét phấn trắng (Chalkboard Sketch) |
| **2. Board Pages & Snapshots** | `POST` | `/api/v1/sessions/pages` | Lưu trạng thái nét vẽ theo trang và phiên học |
| | `GET` | `/api/v1/sessions/pages/{room_id}/{session_id}` | Lấy danh sách các trang vẽ trong phòng học |
| | `POST` | `/api/v1/sessions/snapshots` | Lưu ảnh bảng Snapshot độ nét cao trước khi xóa |
| | `GET` | `/api/v1/sessions/snapshots` | Tìm kiếm danh sách ảnh Snapshot theo lớp, ngày, OCR |
| | `GET` | `/api/v1/sessions/snapshots/{id}/image` | Tải file ảnh bảng độ phân giải cao (.webp / .png) |
| **3. Teacher & Student Auth** | `POST` | `/api/v1/auth/teacher/otp/request` | Yêu cầu mã OTP qua Email cho giáo viên |
| | `POST` | `/api/v1/auth/teacher/otp/verify` | Xác thực OTP đăng nhập phiên giáo viên 14 ngày |
| | `POST` | `/api/v1/auth/student/register` | Đăng ký tài khoản học sinh / phụ huynh |
| | `POST` | `/api/v1/auth/student/login` | Đăng nhập tài khoản học sinh |
| | `GET` | `/api/v1/auth/me` | Lấy thông tin người dùng hiện tại và phân quyền lớp |
| **4. Offline Synchronization** | `POST` | `/api/v1/offline-sync/batch` | Đồng bộ hàng loạt snapshot từ IndexedDB lên server |
| | `GET` | `/api/v1/offline-sync/status` | Kiểm tra trạng thái hàng đợi và dung lượng đệm |
| | `GET` | `/api/v1/offline-sync/health` | Kiểm tra kết nối mạng học đường (Health Check) |
| **5. Exam & Quiz Management** | `POST` | `/api/v1/exam/upload` | Tải file đề thi (.docx, .pdf, .txt) và bóc tách câu hỏi |
| | `POST` | `/api/v1/exam/circle-answer` | Tiếp nhận nét khoanh tròn đáp án trắc nghiệm |
| | `GET` | `/api/v1/exam/circle-submissions` | Xem danh sách bài thi trắc nghiệm đã khoanh |
| | `POST` | `/api/v1/exam/grade-mcq` | Chấm điểm câu hỏi trắc nghiệm & giải thích nhiễu |
| | `POST` | `/api/v1/exam/grade-essay-step` | AI chấm tự luận từng dòng viết tay (tích xanh, gạch đỏ) |
| | `POST` | `/api/v1/exam/generate-variant` | AI sinh bài tập tương tự / nâng cao độ khó |
| **6. Student Scores & Roster** | `GET` | `/api/v1/scores/students` | Danh sách học sinh theo lớp kèm tổng điểm thưởng |
| | `POST` | `/api/v1/scores/students` | Thêm nhanh học sinh vào danh sách lớp |
| | `POST` | `/api/v1/scores/award` | Cộng điểm thưởng kèm lưu snapshot bài làm |
| | `GET` | `/api/v1/scores/history` | Lịch sử cộng điểm thưởng theo phòng học / học sinh |
| | `GET` | `/api/v1/scores/leaderboard` | Bảng xếp hạng học sinh đạt điểm thưởng cao nhất |
| **7. Performance Benchmark** | `POST` | `/api/v1/benchmark/run-full-audit` | Đo độ trễ nét vẽ, AI mạng thường/yếu và cô lập 2 phòng |
| | `GET` | `/api/v1/benchmark/curriculum-formulas` | Danh mục 31 công thức SGK chuẩn phổ thông |
| **8. Admin & Quota Management** | `GET` | `/api/v1/admin/ai-quotas` | Thống kê số lượt gọi Gemini 2.5 Flash / Mathpix OCR |
| | `GET` | `/api/v1/admin/classes` | Danh sách các lớp học đang hoạt động trên hệ thống |

---

## 3. CHI TIẾT CÁC ENDPOINT QUAN TRỌNG

### 3.1. Nhóm 1: Nhận diện Nét vẽ AI & Minh họa Phấn trắng

#### `POST /api/v1/recognize`
- **Tóm tắt:** Bóc tách công thức Toán/Lý/Hóa, đồ thị tương tác và hình minh họa từ nét vẽ Canvas.
- **Tiêu đề Request:**
  - `Content-Type: application/json`
- **Body Request (JSON):**
```json
{
  "session_id": "session-10a1-toan",
  "room_id": "room-10a1",
  "subject": "TOAN",
  "page_number": 1,
  "image_base64": "data:image/png;base64,iVBORw0KGgo...",
  "stroke_hint": "y = ax^2 + bx + c",
  "debounce_ms": 800,
  "provider": "auto",
  "grade_level": "THPT"
}
```
- **Response 200 OK (Thành công):**
```json
{
  "session_id": "session-10a1-toan",
  "room_id": "room-10a1",
  "page_number": 1,
  "subject": "TOAN",
  "provider": "curriculum-formula-engine",
  "recognized_text": "y = ax^2 + bx + c",
  "latex": "y = ax^2 + bx + c",
  "confidence": 0.99,
  "needs_correction": false,
  "suggestions": [],
  "latency_ms": 6,
  "debounce_ms": 800,
  "preprocess": {
    "original_size": [1920, 1080],
    "cropped_size": [340, 120],
    "bounding_box": { "x": 120, "y": 80, "width": 340, "height": 120 },
    "processed_base64": "data:image/webp;base64,...",
    "size_reduction_percent": 84.5
  },
  "visualization": {
    "type": "2D_GRAPH",
    "engine": "plotly",
    "title": "Đồ thị Parabol y = ax^2 + bx + c",
    "parameters": {
      "function": "x**2 - 4*x + 3",
      "x_range": [-2, 6],
      "vertex": [2, -1],
      "roots": [1, 3]
    },
    "latex_formula": "y = ax^2 + bx + c"
  },
  "explanation": "Dạng hàm số bậc hai tổng quát đồ thị hình parabol."
}
```

---

### 3.2. Nhóm 2: Quản lý Trang bảng & Ảnh chụp Snapshot

#### `POST /api/v1/sessions/snapshots`
- **Tóm tắt:** Lưu ảnh bảng độ phân giải cao (.webp/.png) vào MinIO/PostgreSQL trước khi xóa bảng.
- **Body Request (JSON):**
```json
{
  "session_id": "session-10a1-toan",
  "room_id": "room-10a1",
  "class_name": "10A1",
  "teacher_name": "Nguyễn Tuấn Khang",
  "subject": "TOAN",
  "period_number": 1,
  "page_number": 1,
  "trigger_type": "BEFORE_CLEAR",
  "image_base64": "data:image/png;base64,iVBORw0KGgo...",
  "recognized_latex": "y = x^2 - 4x + 3"
}
```
- **Response 200 OK:**
```json
{
  "status": "saved",
  "snapshot_id": "b3e94411-cf08-4e3b-9a42-7efc921ba999",
  "tags": {
    "teacher_name": "Nguyễn Tuấn Khang",
    "class_name": "10A1",
    "subject": "TOAN",
    "period_number": 1,
    "page_number": 1,
    "date": "2026-11-22"
  },
  "image_url": "https://storage.local/snapshots/10a1/2026-11-22/snap_01.webp",
  "preview_url": "/api/v1/sessions/snapshots/b3e94411-cf08-4e3b-9a42-7efc921ba999/image?format=webp",
  "image_format": "webp",
  "created_at": "2026-11-22T03:30:00Z",
  "retention_until": "2027-05-22T03:30:00Z",
  "total_snapshots": 12
}
```

---

### 3.3. Nhóm 3: Xác thực Người dùng & Phân quyền

#### `POST /api/v1/auth/teacher/otp/verify`
- **Tóm tắt:** Giáo viên nhập OTP nhận qua email để đăng nhập phiên học và duy trì đăng nhập 14 ngày.
- **Body Request:**
```json
{
  "email": "giaovien.toan@truong.edu.vn",
  "otp": "849201",
  "device_id": "screen_allinone_4k_p01",
  "remember_14_days": true
}
```
- **Response 200 OK:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsIn...",
  "token_type": "bearer",
  "expires_in": 1209600,
  "remember_days": 14,
  "user_id": "usr_teacher_01",
  "role": "TEACHER",
  "full_name": "Thầy Nguyễn Tuấn Khang",
  "allowed_classes": ["10A1", "10A2", "11B1"]
}
```

---

### 3.4. Nhóm 4: Đồng bộ Ngoại tuyến (Offline Sync)

#### `POST /api/v1/offline-sync/batch`
- **Tóm tắt:** Đẩy danh sách các ảnh Snapshot được lưu tạm trong IndexedDB khi mất mạng lên máy chủ.
- **Body Request:**
```json
{
  "client_device_id": "screen_allinone_4k_p01",
  "items": [
    {
      "client_sync_id": "idb_sync_5829104",
      "session_id": "session-10a1-toan",
      "room_id": "room-10a1",
      "class_name": "10A1",
      "teacher_name": "Nguyễn Tuấn Khang",
      "subject": "TOAN",
      "period_number": 1,
      "page_number": 2,
      "trigger_type": "BEFORE_CLEAR",
      "image_base64": "data:image/png;base64,...",
      "captured_at": "2026-11-22T02:15:30Z"
    }
  ]
}
```
- **Response 200 OK:**
```json
{
  "status": "synced",
  "received_count": 1,
  "saved_count": 1,
  "duplicate_count": 0,
  "errors": []
}
```

---

### 3.5. Nhóm 5: Đề thi, Chấm bài Trắc nghiệm & Chấm Tự luận AI

#### `POST /api/v1/exam/circle-answer`
- **Tóm tắt:** Bắt vùng tọa độ nét vẽ khoanh tròn đáp án trắc nghiệm trên mặt bảng và chấm điểm.
- **Body Request:**
```json
{
  "question_id": "q_math_01",
  "session_id": "session-10a1-toan",
  "room_id": "room-10a1",
  "student_id": "stu_10a1_05",
  "selected_label": "B",
  "correct_label": "B",
  "stroke_bbox": { "x": 120.0, "y": 240.0, "width": 45.0, "height": 40.0 },
  "option_regions": [
    { "label": "A", "x": 120.0, "y": 180.0, "width": 60.0, "height": 45.0 },
    { "label": "B", "x": 120.0, "y": 240.0, "width": 60.0, "height": 45.0 }
  ],
  "selection_method": "CIRCLE"
}
```
- **Response 200 OK:**
```json
{
  "submission_id": "circle_7a9c8d123456",
  "matched_label": "B",
  "overlap_score": 0.885,
  "selection_method": "CIRCLE",
  "grade_result": {
    "is_correct": true,
    "score": 1.0,
    "feedback": "Chính xác! Bạn đã chọn đúng phương án B theo định luật và số liệu bài toán."
  }
}
```

#### `POST /api/v1/exam/grade-essay-step`
- **Tóm tắt:** AI chấm từng dòng giải bài tập tự luận viết tay: tích xanh bước đúng, gạch chân đỏ bước sai và gợi ý không lộ bài giải.
- **Body Request:**
```json
{
  "step_number": 2,
  "raw_latex": "x^2 - 4x + 3 = 0 \\implies x = 1 \\text{ hoặc } x = 3",
  "expected_concept": "Tìm nghiệm phương trình bậc hai bằng phân tích hoặc biệt thức Delta",
  "previous_steps_status": [true],
  "solution_guidelines": "Phương trình có delta = 4, x1 = 1, x2 = 3"
}
```
- **Response 200 OK:**
```json
{
  "step_number": 2,
  "is_valid": true,
  "status_badge": "GREEN_CHECK",
  "feedback_message": "Chính xác: Nghiệm của phương trình hoàn toàn đúng.",
  "pedagogical_hint": null,
  "score_awarded": 1.0
}
```

---

### 3.6. Nhóm 6: Danh sách Học sinh & Điểm thưởng Sidebar

#### `POST /api/v1/scores/award`
- **Tóm tắt:** Giáo viên cộng điểm thưởng trên thanh Sidebar cho học sinh kèm chụp ảnh Snapshot bài làm lưu trữ.
- **Body Request:**
```json
{
  "student_id": "stu_10a1_02",
  "student_name": "Trần Quốc Bảo",
  "class_name": "10A1",
  "session_id": "session-10a1-toan",
  "room_id": "room-10a1",
  "teacher_name": "Nguyễn Tuấn Khang",
  "subject": "TOAN",
  "points_added": 2.0,
  "reason": "Lên bảng giải xuất sắc câu hỏi đồ thị Parabol",
  "image_base64": "data:image/png;base64,..."
}
```
- **Response 200 OK:**
```json
{
  "status": "awarded",
  "total_points": 8.5,
  "snapshot_saved": true,
  "record": {
    "id": "score_8a7d9b0123ef",
    "student_id": "stu_10a1_02",
    "student_name": "Trần Quốc Bảo",
    "class_name": "10A1",
    "points_added": 2.0,
    "total_points": 8.5,
    "reason": "Lên bảng giải xuất sắc câu hỏi đồ thị Parabol",
    "snapshot_url": "https://storage.local/snapshots/10a1/snap_bonus_02.webp",
    "created_at": "2026-11-22T03:35:00Z"
  }
}
```

---

### 3.7. Nhóm 7: Benchmark Đo kiểm Hiệu năng & Cô lập Đa phòng

#### `POST /api/v1/benchmark/run-full-audit`
- **Tóm tắt:** Chạy toàn diện 4 hạng mục đo kiểm: Độ trễ nét vẽ (< 16ms), Thời gian AI (< 2s thường, < 5s yếu), Độ chính xác SGK (>= 90%) và Cô lập 2 phòng học song song (0% rò rỉ).
- **Query Parameters:**
  - `simulated_strokes_count`: Số nét vẽ mô phỏng (mặc định: 100).
  - `degraded_latency_ms`: Độ trễ mạng yếu giả lập (mặc định: 1800 ms).
- **Response 200 OK:**
```json
{
  "task_id": "TF28522",
  "timestamp": "2026-11-22T03:48:09Z",
  "status": "PASSED",
  "stroke_latency": {
    "sample_count": 100,
    "avg_ms": 2.01,
    "max_ms": 3.20,
    "threshold_ms": 16.0,
    "fps_equivalent": 497.5,
    "passed": true
  },
  "ai_response_normal": {
    "response_time_ms": 5.67,
    "threshold_ms": 2000.0,
    "provider_used": "curriculum-formula-engine",
    "passed": true
  },
  "ai_response_degraded": {
    "simulated_network_delay_ms": 1800.0,
    "total_response_time_ms": 1804.42,
    "threshold_ms": 5000.0,
    "passed": true
  },
  "formula_accuracy": {
    "dataset_size": 31,
    "correct_recognitions": 31,
    "accuracy_percent": 100.0,
    "target_threshold_percent": 90.0,
    "passed": true
  },
  "multi_room_isolation": {
    "cross_leakage_detected": false,
    "passed": true
  },
  "all_criteria_met": true
}
```

---

## 4. BẢNG MÃ LỖI HTTP TIÊU CHUẨN (ERROR CODES)

| Mã lỗi HTTP | Tên mã lỗi | Mô tả chi tiết | Nguyên nhân & Hướng giải quyết |
|:---:|:---|:---|:---|
| **400** | `Bad Request` | Yêu cầu không hợp lệ | Payload JSON sai định dạng hoặc tọa độ nét khoanh nằm ngoài biên các phương án |
| **401** | `Unauthorized` | Chưa xác thực | Thiếu hoặc hết hạn JWT Bearer Token, mã OTP giáo viên không hợp lệ |
| **403** | `Forbidden` | Không có quyền truy cập | Học sinh cố ý truy cập dữ liệu của lớp học khác ngoài danh sách lớp được phân quyền |
| **404** | `Not Found` | Không tìm thấy tài nguyên | Không tìm thấy `snapshot_id`, `student_id` hoặc bài thi tương ứng |
| **409** | `Conflict` | Xung đột dữ liệu | Trùng mã học sinh trong cùng một lớp học (`HTTP 409 Conflict`) |
| **422** | `Unprocessable Content` | Lỗi xác thực dữ liệu đầu vào | Pydantic Schema Validation failed (thiếu trường bắt buộc hoặc sai kiểu dữ liệu) |
| **500** | `Internal Server Error` | Lỗi máy chủ nội bộ | Lỗi kết nối AI provider ngoài hoặc lỗi hệ thống lưu trữ blob |
