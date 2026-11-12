# Hướng Dẫn Bắt Buộc Cho AI Agent (Antigravity) Khi Làm Task Trong Repo Này

Khi thành viên trong nhóm (**Nguyễn Tuấn Khang**, **Hoàng Minh Nghĩa**, hoặc **Nguyễn Ngọc Gia Bảo**) yêu cầu bạn làm một Task trên hệ thống RikkeiEdu:

1. **Đọc kỹ file `README.md`** để biết:
   - Phân vùng thư mục của từng thành viên (tuyệt đối không sửa đè vào file của thành viên khác để tránh conflict).
   - Bảng ánh xạ từng Task với tên file cần tạo/sửa ở Mục 3 của `README.md`.
2. **Hỏi hoặc kiểm tra Mã Task (`TFxxxxx`)**:
   - Nếu người dùng chưa cung cấp mã `TFxxxxx` (ví dụ `TF28506`), hãy hỏi họ mã `TF...` hiển thị ở mục GitHub bên phải thẻ task trên RikkeiEdu.
3. **Thực hiện chuẩn quy trình Git Flow (Bắt buộc vì nhánh `main` đã khóa Branch Protection)**:
   - Luôn chạy `git checkout main && git pull origin main` trước khi tạo nhánh mới.
   - Tạo nhánh riêng: `git checkout -b feature/<ma-task-viet-thuong>-<mo-ta-ngan>` (ví dụ: `feature/tf28506-opencv-preprocess`).
   - Viết code đầy đủ cho các file của task đó.
   - Commit có mã task ở đầu: `git commit -m "TFxxxxx: <tên task>"`.
   - Đẩy nhánh lên: `git push -u origin feature/<ma-task-viet-thuong>-<mo-ta-ngan>`.
   - Dùng `gh pr create --base main --head feature/... --title "TFxxxxx: <Tên task>" --body "..."` để tạo Pull Request vào `main` (hoặc đưa link tạo PR trên GitHub cho người dùng).
   - Cuối cùng, đưa đường link Pull Request (`https://github.com/tuankhn/ai-interactive-canvas/pull/...`) cho người dùng dán vào ô **Link minh chứng** trên RikkeiEdu.
