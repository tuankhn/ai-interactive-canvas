# AI Interactive Canvas — Bảng Vẽ Thông Minh Hỗ Trợ Giảng Dạy

Dự án thực tập: Hệ thống bảng vẽ tương tác thông minh tích hợp AI đa phương thức hỗ trợ giảng dạy tại lớp học (Smartboard) và cổng ôn tập xem lại bài giảng tại nhà cho học sinh/phụ huynh.

---

## 1. Phân Vùng Code Theo Thành Viên (Chống Conflict 100%)

Mỗi thành viên (và AI Agent hỗ trợ thành viên đó) **chỉ tạo/sửa file trong đúng phân vùng của mình** để không bao giờ xảy ra xung đột (conflict) khi gộp code:

1. **Nguyễn Tuấn Khang (Leader / Fullstack)**
   - **Phạm vi công việc**: Kiến trúc CSDL PostgreSQL 16+, FastAPI, Docker, Redis 7+, MinIO, Xác thực OTP/SĐT, Lưu trữ Snapshot, Offline Mode, Trang Admin.
   - **Thư mục phụ trách**:
     - `docker-compose.yml`, `backend/Dockerfile`, `backend/requirements.txt`
     - `backend/app/core/` (`config.py`, `database.py`, `storage.py`, `security.py`)
     - `backend/app/models/`
     - `backend/app/api/session_router.py`, `backend/app/api/auth_router.py`, `backend/app/api/admin_router.py`
     - `docs/database_schema.sql`, `docs/erd_diagram.png`

2. **Hoàng Minh Nghĩa (Frontend)**
   - **Phạm vi công việc**: Wireframe, Bảng vẽ tương tác `Fabric.js` (Stylus/Touch/Mouse, Palm Rejection, độ trễ `< 16ms`), bộ công cụ vẽ & hình học phẳng, phân trang & popup xóa bảng, đồ thị 2D (`Plotly.js`), mô hình 3D (`Three.js`, `3Dmol.js`), giao diện trắc nghiệm & Cổng ôn tập tại nhà.
   - **Thư mục phụ trách**:
     - Toàn bộ thư mục `frontend/` (`frontend/index.html`, `frontend/styles.css`, `frontend/app.js`, `frontend/src/components/`, `frontend/src/pages/`, `frontend/src/utils/`)
     - `docs/wireframe_preview.png`, `docs/sprint1_business_flow_and_wireframe.md`

3. **Nguyễn Ngọc Gia Bảo (AI / Backend)**
   - **Phạm vi công việc**: Tiền xử lý ảnh vùng vẽ bằng `OpenCV` & `Pillow` (khử nhiễu, đảo nền bảng đen, cắt sát khung chữ Bounding Box), kết nối `Gemini 2.5 Flash API` & `Mathpix API`, chuẩn hóa Prompt đa môn (Toán, Lý, Hóa, Anh), sinh ảnh minh họa từ vựng, bóc tách đề `.docx`/`.pdf`, logic chấm trắc nghiệm/tự luận & kiểm thử hiệu năng.
   - **Thư mục phụ trách**:
     - `backend/app/services/` (`image_preprocess.py`, `ai_recognition.py`, `quiz_parser.py`, `grading_service.py`)
     - `backend/app/ai/` (`prompts.py`, `vocab_illustrator.py`, `question_generator.py`)
     - `backend/app/api/recognize_router.py`, `backend/app/api/grading_router.py`, `backend/app/api/quiz_router.py`
     - `backend/tests/`

> **Lưu ý về `backend/app/main.py`**: File `main.py` đã dùng cơ chế `try ... except ImportError` để tự động gắn các router. Nếu cần thêm router mới vào `main.py`, hãy bọc trong khối `try ... except ImportError` ở cuối danh sách router để không làm hỏng nhánh của người khác.

---

## 2. Chỉ Dẫn Tự Động Dành Cho AI Agent (Antigravity / Cursor / Copilot)

Nếu bạn là **AI Agent (Antigravity)** đang chạy trên máy của thành viên (**Bảo**, **Nghĩa**, hoặc **Khang**), khi người dùng gửi **Tên task** và **Mã task (dạng `TFxxxxx`, ví dụ `TF28506`)**, hãy **TỰ ĐỘNG thực hiện trọn gói 6 bước sau**:

### Bước 1: Đồng bộ nhánh `main` mới nhất
```bash
git checkout main
git pull origin main
```

### Bước 2: Tạo nhánh riêng theo đúng chuẩn Git Flow của Giảng viên
- **TUYỆT ĐỐI KHÔNG** commit hoặc push trực tiếp vào `main` (nhánh `main` đã bật Branch Protection).
- Đặt tên nhánh theo mẫu `feature/<ma-task-viet-thuong>-<ten-ngan-khong-dau>`:
```bash
git checkout -b feature/tf28506-xu-ly-anh-opencv
```

### Bước 3: Viết code hoàn chỉnh cho Task đó
- Chỉ tạo/sửa các file thuộc phân vùng của thành viên đó (xem Mục 1 và Bảng danh sách Task ở Mục 3).
- Đảm bảo code chạy thực tế, sạch sẽ, có fallback an toàn nếu chưa cấu hình API key bên thứ ba.
- Với task yêu cầu nộp `File` (hoặc `Link hoặc file`), xuất thêm file tài liệu/ảnh/zip vào thư mục `docs/` để thành viên tải lên web RikkeiEdu.

### Bước 4: Kiểm tra xung đột với `main` trước khi đẩy
```bash
git fetch origin main
git rebase origin/main
```

### Bước 5: Commit và Push nhánh lên GitHub (Bắt buộc có mã `TFxxxxx` ở đầu)
Hệ thống RikkeiEdu tự động quét mã `TFxxxxx` trong **tên nhánh**, **commit message** và **tiêu đề Pull Request**:
```bash
git add .
git commit -m "TF28506: xử lý ảnh vùng vẽ bằng OpenCV và Pillow trước khi gửi AI"
git push -u origin feature/tf28506-xu-ly-anh-opencv
```

### Bước 6: Tạo Pull Request vào nhánh `main` và trả link cho người dùng
- Nếu máy đã đăng nhập `gh` (GitHub CLI), chạy lệnh tạo PR tự động:
  ```bash
  gh pr create --base main --head feature/tf28506-xu-ly-anh-opencv \
    --title "TF28506: Xử lý ảnh vùng vẽ bằng OpenCV và Pillow trước khi gửi AI" \
    --body "Hoàn thành task TF28506 theo đặc tả SRS."
  ```
- Nếu máy chưa cài `gh`, hãy in ra đường link trực tiếp để người dùng bấm mở tạo PR:
  `https://github.com/tuankhn/ai-interactive-canvas/pull/new/feature/tf28506-xu-ly-anh-opencv`
- Sau đó nhắc người dùng: **Copy link Pull Request vừa tạo dán vào ô `Link minh chứng` trên RikkeiEdu và chuyển trạng thái sang `Hoàn thành`**.

---

## 3. Danh Sách Chi Tiết Các Task Theo Sprint & File Cần Làm Cho Từng Thành Viên

### A. Các Task của Nguyễn Ngọc Gia Bảo (AI / Backend)
| Sprint | Ngày | Tên Task trên RikkeiEdu | File cần tạo / cập nhật |
| :---: | :---: | :--- | :--- |
| Sprint 2 | Ngày 7 | Xử lý ảnh vùng vẽ bằng OpenCV và Pillow trước khi gửi AI | `backend/app/services/image_preprocess.py` |
| Sprint 2 | Ngày 8 | Kết nối API Gemini 2.5 Flash và Mathpix nhận diện nét viết | `backend/app/services/ai_recognition.py` |
| Sprint 2 | Ngày 8 | Ghép luồng vẽ trên Canvas với API nhận diện AI | `backend/app/api/recognize_router.py`, `backend/tests/test_sprint1.py` |
| Sprint 2 | Ngày 9 | Viết prompt AI bóc tách công thức Toán, Lý, Hóa và từ vựng Anh | `backend/app/ai/prompts.py` |
| Sprint 2 | Ngày 10 | Làm tính năng AI tạo ảnh minh họa từ vựng và khái niệm | `backend/app/ai/vocab_illustrator.py` |
| Sprint 3 | Ngày 11 | Kiểm thử luồng viết công thức, dựng đồ thị 2D và lưu Snapshot | `backend/tests/test_sprint2_flow.py` |
| Sprint 3 | Ngày 13 | Làm chức năng tải đề từ file DOCX/PDF và tự động ẩn đáp án | `backend/app/services/quiz_parser.py`, `backend/app/api/quiz_router.py` |
| Sprint 3 | Ngày 14 | Viết logic chấm trắc nghiệm và giải thích các phương án gây nhiễu | `backend/app/services/grading_service.py`, `backend/app/api/grading_router.py` |
| Sprint 3 | Ngày 14 | Viết logic AI chấm bài giải tự luận theo từng dòng viết tay | Cập nhật `backend/app/services/grading_service.py` |
| Sprint 3 | Ngày 14 | Làm tính năng AI tạo câu hỏi tương tự và câu hỏi nâng cao *(Bonus)* | `backend/app/ai/question_generator.py` |
| Sprint 4 | Ngày 17 | Đo kiểm hiệu năng, độ trễ và kiểm thử cô lập dữ liệu nhiều lớp | `backend/tests/test_performance_and_isolation.py`, `docs/performance_report.md` |
| Sprint 4 | Ngày 18 | Viết tài liệu Test Cases và tài liệu đặc tả API | `docs/test_cases_and_api_spec.md` |
| Sprint 4 | Ngày 19 | Làm slide báo cáo và kịch bản trình diễn (Demo) | `docs/demo_script_and_slides_outline.md` |

### B. Các Task của Hoàng Minh Nghĩa (Frontend)
| Sprint | Ngày | Tên Task trên RikkeiEdu | File cần tạo / cập nhật |
| :---: | :---: | :--- | :--- |
| Sprint 2 | Ngày 6 | Chốt luồng nghiệp vụ và vẽ wireframe giao diện | `docs/wireframe_preview.png`, `docs/sprint1_business_flow_and_wireframe.md` |
| Sprint 2 | Ngày 7 | Dựng bảng vẽ Fabric.js hỗ trợ bút cảm ứng, tay và chuột | `frontend/index.html`, `frontend/styles.css` |
| Sprint 2 | Ngày 7 | Làm bộ công cụ vẽ cơ bản và vẽ hình học phẳng | `frontend/app.js` |
| Sprint 2 | Ngày 8 | Làm tính năng thêm trang, chuyển trang và xóa bảng | `frontend/src/utils/pagination.js` (hoặc cập nhật `frontend/app.js`) |
| Sprint 2 | Ngày 9 | Làm nút chuyển nét chữ viết tay sang văn bản và LaTeX trên bảng | `frontend/src/components/latex_converter.js` |
| Sprint 2 | Ngày 10 | Tích hợp Plotly.js vẽ đồ thị hàm số 2D từ phương trình viết tay | `frontend/src/components/graph_2d_plotly.js` |
| Sprint 3 | Ngày 11 | Tích hợp 3Dmol.js dựng mô hình phân tử Hóa học 3D *(Bonus)* | `frontend/src/components/molecule_3d.js` |
| Sprint 3 | Ngày 13 | Làm popup gợi ý sửa ký tự khi AI nhận diện chưa chắc chắn | `frontend/src/components/correction_popup.js` |
| Sprint 3 | Ngày 13 | Thiết kế giao diện câu hỏi trắc nghiệm và bắt nét khoanh đáp án | `frontend/src/components/quiz_board.js` |
| Sprint 3 | Ngày 15 | Làm thanh danh sách học sinh và cộng điểm thưởng trên bảng *(Bonus)* | `frontend/src/components/student_score_sidebar.js` |
| Sprint 3 | Ngày 15 | Tích hợp Three.js dựng hình học không gian 3D tương tác | `frontend/src/components/geometry_3d_three.js` |
| Sprint 4 | Ngày 16 | Xây dựng Cổng ôn tập tại nhà cho Học sinh và Phụ huynh | `frontend/src/pages/student_portal.html`, `frontend/src/pages/student_portal.js` |
| Sprint 4 | Ngày 17 | Kiểm thử thực tế trên Tablet/màn hình cảm ứng và chỉnh lại UI | `docs/tablet_ui_test_report.md`, cập nhật `frontend/styles.css` |

### C. Các Task của Nguyễn Tuấn Khang (Leader / Fullstack)
| Sprint | Ngày | Tên Task trên RikkeiEdu | File cần tạo / cập nhật |
| :---: | :---: | :--- | :--- |
| Sprint 2 | Ngày 6 | Thiết kế CSDL PostgreSQL và vẽ ERD *(Đã xong - `TF28502`)* | `docs/database_schema.sql`, `docs/erd_diagram.png` |
| Sprint 2 | Ngày 6 | Khởi tạo dự án FastAPI, cấu hình Docker, Redis và MinIO *(Đã xong - `TF28503`)* | `docker-compose.yml`, `backend/Dockerfile`, `backend/app/main.py` |
| Sprint 2 | Ngày 9 | Họp nhóm tổng kết Sprint 1 | `docs/sprint1_review.md` |
| Sprint 2 | Ngày 10 | Viết API chụp Snapshot bảng học lưu lên MinIO và PostgreSQL *(Đã xong - `TF2850E`)* | `backend/app/core/storage.py`, `backend/app/api/session_router.py` |
| Sprint 3 | Ngày 11 | Xử lý chế độ mất mạng (Offline Mode) và tự đồng bộ lại | `frontend/src/utils/offline_sync.js`, `backend/app/api/offline_sync_router.py` |
| Sprint 3 | Ngày 12 | Họp nhóm tổng kết Sprint 2 | `docs/sprint2_review.md` |
| Sprint 3 | Ngày 12 | Làm luồng đăng nhập Giáo viên qua OTP Email và giữ phiên 14 ngày | `backend/app/core/security.py`, `backend/app/api/auth_router.py` |
| Sprint 3 | Ngày 12 | Làm luồng đăng nhập Học sinh/Phụ huynh bằng SĐT và phân quyền lớp | Cập nhật `backend/app/api/auth_router.py` |
| Sprint 3 | Ngày 15 | Họp nhóm tổng kết Sprint 3 | `docs/sprint3_review.md` |
| Sprint 4 | Ngày 16 | Làm trang Admin quản lý trường, lớp và theo dõi hạn ngạch AI | `backend/app/api/admin_router.py`, `frontend/src/pages/admin.html` |
| Sprint 4 | Ngày 19 | Đóng gói toàn bộ hệ thống lên Docker và tạo dữ liệu mẫu Demo | `docs/seed_demo_data.sql`, cập nhật `docker-compose.yml` |
| Sprint 4 | Ngày 20 | Họp nhóm tổng kết Sprint 4 và nghiệm thu dự án | `docs/sprint4_final_acceptance.md` |
