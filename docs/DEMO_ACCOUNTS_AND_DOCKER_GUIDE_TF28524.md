# Hướng Dẫn Chạy Docker Compose & Bộ Tài Khoản / Đề Mẫu Demo (`TF28524`)

**Task:** `TF28524` — Đóng gói toàn bộ hệ thống lên Docker và tạo dữ liệu mẫu Demo  
**Phụ trách:** Nguyễn Tuấn Khang (Sprint 4)

---

## 1. Khởi chạy toàn bộ hệ thống bằng 1 lệnh duy nhất

```bash
docker compose up -d --build
```

Hệ thống sẽ tự động dựng và kiểm tra sức khỏe (`healthcheck`) cho 6 thành phần:
1. **`aicanvas_postgres` (`postgres:16-alpine`, cổng `5432`)**: Tự động chạy `01_schema.sql` và nạp dữ liệu mẫu `02_seed_demo_data.sql`.
2. **`aicanvas_redis` (`redis:7-alpine`, cổng `6379`)**: Lưu cache phiên học & kênh đồng bộ thời gian thực.
3. **`aicanvas_minio` (`minio/minio`, cổng `9000` / Console `9001`)** + **`aicanvas_minio_init`**: Tự động khởi tạo bucket `board-snapshots` cấp quyền đọc ảnh bảng.
4. **`aicanvas_backend` (`FastAPI + Python 3.11`, cổng `8000`)**: Chạy toàn bộ REST API, WebSocket đa phòng học và tự động nạp dữ liệu mẫu Demo ngay khi khởi động (`lifespan`).
5. **`aicanvas_frontend` (`nginx:1.27-alpine`, cổng `3000`)**: Đóng gói toàn bộ giao diện Frontend, nén `gzip` và chuyển tiếp `/api/` + `/ws/` sang FastAPI.

### Đường dẫn truy cập khi báo cáo Demo:
- **Bảng vẽ thông minh (Giáo viên tại lớp):** `http://localhost:3000/` *(hoặc `http://localhost:8000/`)*
- **Cổng ôn tập tại nhà (Học sinh / Phụ huynh):** `http://localhost:3000/src/pages/student_portal.html`
- **Cổng Quản trị Admin (Trường, Lớp, Hạn ngạch AI):** `http://localhost:3000/src/pages/admin.html`
- **Tài liệu Swagger OpenAPI:** `http://localhost:8000/docs`
- **MinIO Console:** `http://localhost:9001` (`minioadmin` / `minioadmin123`)

---

## 2. Bộ Tài Khoản Lớp Học Tạo Sẵn Phục Vụ Báo Cáo

| Vai trò | Cổng đăng nhập | Tài khoản (Email / SĐT) | Mật khẩu / OTP Demo | Lớp phụ trách / theo học | Ghi chú kịch bản Demo |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Admin** | `/src/pages/admin.html` | `admin@aicanvas.edu.vn` | `Admin@2026` | Toàn hệ thống | Quản lý 3 trường, 4 lớp, tài khoản GV & biểu đồ hạn ngạch AI/MinIO |
| **Giáo viên Toán - Lý** | `/` (Nút *Đăng nhập GV*) | `gv.toan@aicanvas.edu.vn` · `0901000101` | `Demo@2026` *(OTP: `123456`)* | `10A1`, `12A1` | GVCN lớp `10A1` (THPT Chuyên Lê Hồng Phong) |
| **Giáo viên Hóa - Anh** | `/` (Nút *Đăng nhập GV*) | `gv.hoaanh@aicanvas.edu.vn` · `0901000102` | `Demo@2026` *(OTP: `123456`)* | `10A1`, `8A2` | Dạy Hóa 3D, từ vựng Tiếng Anh & chấm trắc nghiệm |
| **Giáo viên Tiểu học** | `/` (Nút *Đăng nhập GV*) | `gv.tieuhoc@aicanvas.edu.vn` · `0901000103` | `Demo@2026` *(OTP: `123456`)* | `4A1` | GVCN lớp `4A1` (Tiểu học Kim Đồng) |
| **Học sinh THPT** | `/src/pages/student_portal.html` | `0912000101` *(Mã: `10A1-HS-01`)* | `Demo@2026` | `10A1` | **Nguyễn Minh Anh** — có sẵn ảnh bảng 4 môn Toán, Lý, Hóa, Anh & lịch sử điểm thưởng |
| **Học sinh THPT #2** | `/src/pages/student_portal.html` | `0912000102` *(Mã: `10A1-HS-02`)* | `Demo@2026` | `10A1` | **Trần Quốc Bảo** — lớp `10A1` |
| **Học sinh THCS** | `/src/pages/student_portal.html` | `0912000802` *(Mã: `8A2-HS-01`)* | `Demo@2026` | `8A2` | **Phạm Khánh Vy** — dùng để demo cô lập dữ liệu (không xem được bài `10A1`) |
| **Phụ huynh Tiểu học** | `/src/pages/student_portal.html` | `0912000401` *(Mã con: `4A1-HS-01`)* | `Demo@2026` | `4A1` | **Phụ huynh Bé Lê Gia Hân** — xem bài học lớp `4A1` của con tại nhà |

---

## 3. Bộ Đề Mẫu 4 Môn Toán, Lý, Hóa, Anh

Hệ thống đã nạp sẵn ngân hàng đề mẫu cho cả **4 môn học** tại:
1. **API trực tiếp trên bảng thông minh:**
   - `GET /api/v1/exam/sample?subject=TOAN&mode=STUDENT`
   - `GET /api/v1/exam/sample?subject=VAT_LY&mode=STUDENT`
   - `GET /api/v1/exam/sample?subject=HOA_HOC&mode=STUDENT`
   - `GET /api/v1/exam/sample?subject=TIENG_ANH&mode=STUDENT`
   - Hoặc xem trọn bộ qua `GET /api/v1/demo/exams`
2. **Tệp đề thi mẫu để tải trực tiếp lên bảng (`Nút Tải đề thi`):**
   - `docs/demo_exams/de_mau_toan_10a1.txt`
   - `docs/demo_exams/de_mau_vat_ly_10a1.txt`
   - `docs/demo_exams/de_mau_hoa_hoc_10a1.txt`
   - `docs/demo_exams/de_mau_tieng_anh_10a1.txt`
3. **Khôi phục nhanh dữ liệu Demo trước khi lên thuyết trình:**
   - Gọi `POST /api/v1/demo/reseed` để làm mới tức thì toàn bộ tài khoản, lớp học, ảnh bảng và điểm thưởng mẫu mà không cần khởi động lại Docker.
