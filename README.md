# AI Interactive Canvas — Bảng Vẽ Thông Minh Hỗ Trợ Giảng Dạy

Dự án thực tập: Hệ thống bảng vẽ tương tác thông minh tích hợp AI hỗ trợ giảng dạy tại lớp học (Smartboard) và cổng ôn tập xem lại bài giảng tại nhà cho học sinh/phụ huynh.

## Thành viên thực hiện
- **Nguyễn Tuấn Khang** (Leader / Fullstack): Kiến trúc CSDL PostgreSQL, FastAPI, Docker, MinIO, Xác thực & Snapshot.
- **Hoàng Minh Nghĩa** (Frontend): Bảng vẽ tương tác Fabric.js, bộ công cụ vẽ, đồ thị 2D/3D (Plotly.js, Three.js) & Cổng ôn tập.
- **Nguyễn Ngọc Gia Bảo** (AI / Backend): Tiền xử lý ảnh OpenCV/Pillow, tích hợp Gemini 2.5 Flash / Mathpix & Logic chấm bài tự động.

## Cấu trúc thư mục dự án

```text
ai-interactive-canvas/
├── docs/                       # Tài liệu thiết kế, sơ đồ ERD, file khởi tạo SQL, kịch bản kiểm thử
├── frontend/                   # Giao diện Bảng vẽ tương tác (Fabric.js, Plotly.js, Three.js) & Portal
│   ├── public/
│   └── src/
│       ├── components/         # Các thành phần giao diện (Bảng vẽ, Thanh công cụ, Đồ thị, Popup)
│       ├── pages/              # Màn hình Bảng vẽ phòng học, Cổng ôn tập Học sinh, Trang Admin
│       └── utils/              # Các hàm tiện ích, kết nối API / WebSocket / IndexedDB
└── backend/                    # Máy chủ FastAPI & WebSocket điều phối trung tâm
    ├── app/
    │   ├── api/                # Các route API (Xác thực, Nhận diện AI, Phiên học, Snapshot)
    │   ├── ai/                 # Module kết nối Gemini 2.5 Flash, Mathpix & Prompt đa môn
    │   ├── core/               # Cấu hình hệ thống, kết nối PostgreSQL, Redis, MinIO
    │   ├── models/             # Các model cơ sở dữ liệu
    │   ├── schemas/            # Pydantic schemas kiểm tra dữ liệu đầu vào/đầu ra
    │   └── services/           # Tiền xử lý ảnh (OpenCV/Pillow) và xử lý nghiệp vụ
    └── tests/                  # Kiểm thử tự động
```

## Quy trình làm việc với Git (Gắn mã Task RikkeiEdu)

1. Chuyển sang nhánh `develop` và kéo code mới nhất:
   ```bash
   git checkout develop
   git pull origin develop
   ```
2. Tạo nhánh mới theo **Mã task** trên hệ thống (ví dụ `TF28501`):
   ```bash
   git checkout -b feature/tf28501-ten-task
   ```
3. Commit code có kèm **Mã task** ở đầu:
   ```bash
   git add .
   git commit -m "TF28501: mô tả ngắn gọn công việc"
   git push -u origin feature/tf28501-ten-task
   ```
4. Tạo **Pull Request (PR)** vào nhánh `develop` với tiêu đề bắt đầu bằng `TF28501: ...` và dán link vào mục **Minh chứng** trên hệ thống.
