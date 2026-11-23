# Báo Cáo Kiểm Thử Thực Tế Trên Tablet / Màn Hình Cảm Ứng & Tinh Chỉnh Giao Diện (`TF28521`)

- **Mã công việc (Task ID):** `TF28521`
- **Tên công việc:** Kiểm thử thực tế trên Tablet/màn hình cảm ứng và chỉnh lại UI
- **Sprint:** Sprint 4 (Ngày 17)
- **Người thực hiện:** Hoàng Minh Nghĩa (`N25DTCN037`) — Phân vùng Frontend & Trải nghiệm tương tác
- **Ngày hoàn thành:** 23/11/2026

---

## 1. Mục Tiêu Kiểm Thử & Tinh Chỉnh

Đảm bảo bảng vẽ tương tác thông minh **AI Interactive Canvas** vận hành mượt mà, chính xác và thoải mái về mặt công thái học trên các dòng máy tính bảng phổ biến tại lớp học (**iPadOS / Android Tablet**) cũng như màn hình cảm ứng tương tác khổ lớn (**Smartboard / IFP**):

1. **Kiểm thử thao tác viết bút Stylus & cảm ứng đa điểm:** Độ trễ xem trước nét bút `< 16ms`, cơ chế chống tì tay (*Palm Rejection*) khi đặt lòng bàn tay lên màn hình viết liên tục.
2. **Kiểm thử khoanh tròn & chạm chọn đáp án trắc nghiệm:** Nhận diện chính xác nét khoanh khép kín quanh phương án `A / B / C / D` hoặc thao tác chạm nhanh mà không gây chấm kép (*double-grading*).
3. **Kiểm thử kéo thanh trượt đồ thị 2D (`Plotly.js`) & mặt cắt hình học 3D (`Three.js`):** Kéo mượt các thanh trượt tham số `a, b, c` bằng ngón tay hoặc bút cảm ứng mà không bị trượt tay hay cuộn nhầm khung trang.
4. **Chuẩn hóa kích thước vùng chạm nút bấm `>= 48×48px`:** Đáp ứng chuẩn Material Touch Accessibility (`48×48dp`) và WCAG 2.2 Target Size cho mọi nút công cụ, nút điều hướng trang, nút chấm điểm và điều khiển trên đầu trang.
5. **Tối ưu vị trí thanh công cụ vừa tầm tay (Ergonomic Toolbar Dock):** Tự động neo thanh công cụ xuống **cạnh dưới** khi cầm máy tính bảng dọc (`<= 900px`) và bổ sung bộ chuyển đổi nhanh **Bên trái / Cạnh dưới / Bên phải** cho giáo viên thuận tay phải hoặc đứng giảng trên bảng lớn.

---

## 2. Cấu Hình Thiết Bị & Khung Hình Kiểm Thử

| Thiết bị / Chế độ mô phỏng | Độ phân giải CSS Viewport | Đặc tính con trỏ (`pointer`) | Bố cục thanh công cụ mặc định |
| :--- | :---: | :---: | :--- |
| **iPad Air (Thế hệ 5) — Dọc (Portrait)** | `820 × 1180 px` | `pointer: coarse` (Apple Pencil + Touch) | Thanh ngang neo **Cạnh dưới** vừa tầm ngón cái |
| **iPad Pro 12.9" — Ngang (Landscape)** | `1024 × 768 px` / `1366 × 1024 px` | `pointer: coarse` | Cột dọc hoặc chuyển nhanh **Trái / Dưới / Phải** |
| **Samsung Galaxy Tab S9 — Dọc (Portrait)** | `800 × 1280 px` | `pointer: coarse` (S-Pen + Touch) | Thanh ngang neo **Cạnh dưới**, ngăn kéo HS trượt phải |
| **Bảng tương tác lớp học (Smartboard FHD)** | `1920 × 1080 px` | `pointer: coarse` / `fine` | Hỗ trợ neo **Cạnh dưới** cho giáo viên không phải với cao |

---

## 3. Các Hạng Mục Đã Chỉnh Sửa Giao Diện (`frontend/`)

### 3.1. Chuẩn hóa toàn bộ nút bấm cảm ứng đạt `>= 48×48px`
- Cập nhật biến gốc `--target-size: 48px` trong `frontend/style.css` cho `@media (pointer: coarse), (max-width: 1024px)`.
- Áp đặt tường minh `min-inline-size: 48px; min-block-size: 48px;` cho toàn bộ nhóm điều khiển có độ ưu tiên selector cao:
  - Thanh công cụ chính `.tool-button`: đạt **`56×52px`** ở chế độ cột dọc và **`64×52px`** ở chế độ thanh neo cạnh dưới.
  - Thanh đầu trang: `.topbar-btn`, `.end-button`, `.subject-select`, `.class-select` đạt tối thiểu **`48px`** chiều cao và chiều rộng.
  - Thanh phân trang & chấm điểm: `.page-button` (`<`, `>`, `+ Thêm trang`, `Xóa trang`), `.score-step-btn` (`+1`, `+2`, `+3`, `+5`), `.student-plus-pill`, `.option-button` đều đạt **`>= 48×48px`**.
- Thiết kế lại hệ màu **Swiss Academic Navy & Slate** độ tương phản cao (`>= 4.5:1` WCAG AA) chống chói lóa dưới đèn lớp học, thay biểu tượng emoji không đồng nhất bằng bộ icon vector sắc nét đồng bộ.

### 3.2. Bố trí lại vị trí thanh công cụ vừa tầm tay
- **Tự động neo cạnh dưới trên Tablet dọc (`<= 900px`):** Chuyển `.toolbar` xuống sát cạnh dưới (`order: 2`, ngay phía trên cụm chuyển trang `.footer` và có bù `env(safe-area-inset-bottom)` cho thanh Home Indicator của iPad), giúp người dùng cầm máy tính bảng bằng hai tay đổi công cụ ngay bằng ngón cái mà không che khuất mặt bảng đang viết.
- **Bộ chuyển vị trí công thái học 3 chế độ (`Bên trái` · `Cạnh dưới` · `Bên phải`):** Tích hợp trực tiếp trong menu **Hệ thống** (`#systemInfoPopover` trong `frontend/index.html` & `frontend/src/components/toolbar.js`), lưu tự động vào `localStorage` (`ai-canvas:toolbar-dock:v1`) và tự động tính lại khung vẽ `Fabric.js` ngay lập tức.
- **Ngăn kéo danh sách học sinh thu gọn thông minh (`#toggleStudentsBtn`):** Trên màn hình `<= 1059px`, cột học sinh chuyển thành ngăn kéo trượt mượt (`translateX`) để nhường tối đa diện tích viết bảng.

### 3.3. Tinh chỉnh thao tác kéo thanh trượt đồ thị 2D & công cụ chữ trên màn hình cảm ứng
- **Thanh trượt tham số đồ thị (`frontend/src/extensions/handwriting.css` & `frontend/style.css`):**
  - Mở rộng chiều cao vùng bắt chạm `input[type="range"]` lên **`48px`**, tăng kích thước núm kéo (`slider-thumb`) lên **`28×28px`** và gắn `touch-action: pan-x` để khi kéo hệ số `a, b, c` của đồ thị Parabol / Lượng giác không bị cuộn dọc nhầm nội dung hộp thoại.
  - Tăng kích thước 4 chốt kéo góc ảnh đồ thị trên bảng (`.pg-handle`) từ `18×18px` lên **`26×26px`** dễ bắt bằng ngón tay.
- **Ô nhập chữ nổi trực tiếp (`frontend/src/components/drawingCanvas.js`):** Thay hộp thoại `window.prompt()` chặn luồng cảm ứng bằng ô `<input>` nổi ngay tại tọa độ chạm trên mặt bảng, tương thích bàn phím ảo iPadOS / Gboard tiếng Việt.
- **Tắt mặc định chế độ Tự động nhận diện AI sau mỗi nét vẽ:** Mặc định để **Tự động: TẮT** (và nâng thời gian chờ khi bật lên `1800ms`) để giáo viên viết công thức nhiều nét hoặc vẽ hình minh họa trên Tablet không bị bật hộp thoại AI giữa chừng.

---

## 4. Bảng Kết Quả Kiểm Thử Thực Tế

| Mã Kịch Bản | Hạng mục kiểm thử trên Tablet / Cảm ứng | Tiêu chí nghiệm thu | Kết quả đo thực tế | Đánh giá |
| :---: | :--- | :--- | :--- | :---: |
| **TC-TAB-01** | Viết liên tục bằng bút cảm ứng + chống tì tay (*Palm Rejection*) | Độ trễ nét xem trước `< 16ms`, tì lòng bàn tay trong `900ms` sau bút không sinh nét rác | Độ trễ trung bình **`0.4 – 6.0 ms`** (`60–120 FPS`), khóa `touch` khi `pen` đang hoạt động | **ĐẠT (PASS)** |
| **TC-TAB-02** | Khoanh tròn & chạm chọn đáp án trắc nghiệm trên bảng (`quiz_board.js` / `examManager.js`) | Nét khoanh khép kín quanh đáp án hoặc chạm ngắn `< 300ms` chấm đúng 1 lần duy nhất | Khoanh tròn tự nhận diện đúng phương án `A/B/C/D`; chạm ngắn hit-test qua `getScenePoint` không chấm kép | **ĐẠT (PASS)** |
| **TC-TAB-03** | Kéo thanh trượt hệ số `a, b, c` trên bảng Đồ thị 2D (`Plotly.js`) & mặt cắt 3D (`Three.js`) | Núm kéo nhạy, đồ thị cập nhật mượt không làm trượt cuộn trang nền | Vùng chạm cao **`48px`**, núm kéo **`28×28px`**, `touch-action: pan-x` giữ cố định khung | **ĐẠT (PASS)** |
| **TC-TAB-04** | Đo kích thước vùng chạm (`getBoundingClientRect`) của toàn bộ nút bấm ở chế độ Tablet | `100%` nút công cụ, đầu trang, phân trang, cộng điểm đạt `>= 48×48px` | Nút công cụ: **`64×52px`** (dọc) / **`65×52px`** (ngang); nút Topbar & Phân trang: **`>= 48×48px`** | **ĐẠT (PASS)** |
| **TC-TAB-05** | Kiểm tra vị trí thanh công cụ vừa tầm tay ở cả hướng Dọc (`820×1180`) và Ngang (`1024×768`) | Hướng dọc tự neo xuống cạnh dưới; chuyển đổi *Bên trái / Cạnh dưới / Bên phải* không lệch nét vẽ | Thanh công cụ neo cạnh dưới mượt, cuộn ngang `scroll-snap`, chuyển 3 vị trí giữ nguyên nét trên Canvas | **ĐẠT (PASS)** |
| **TC-TAB-06** | Chuyển lớp học (`10A1 ↔ 12A1`), đổi nền bảng phấn đen và chuyển trang trên Tablet | Giữ nguyên nền bảng và nét vẽ từng trang, `0` lỗi Console | Chuyển trang mượt, khôi phục đúng nền bảng và danh sách học sinh, **`0` lỗi Console** | **ĐẠT (PASS)** |

---

## 5. Kết Luận

Giao diện bảng vẽ thông minh đã hoàn tất kiểm thử cảm ứng và tinh chỉnh theo đúng đặc tả **`TF28521`**: toàn bộ vùng chạm điều khiển đạt chuẩn **`>= 48×48px`**, thanh trượt đồ thị 2D/3D kéo mượt bằng ngón tay và bút cảm ứng, thanh công cụ tự động neo xuống cạnh dưới vừa tầm tay trên Tablet và hỗ trợ chuyển đổi linh hoạt 3 vị trí **Trái / Dưới / Phải** cho mọi tư thế đứng giảng.
