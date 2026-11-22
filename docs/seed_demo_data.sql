-- ============================================================================
-- DỰ ÁN: BẢNG VẼ THÔNG MINH HỖ TRỢ GIẢNG DẠY (AI INTERACTIVE CANVAS)
-- TASK TF28524: ĐÓNG GÓI DOCKER VÀ TẠO DỮ LIỆU MẪU DEMO (TOÁN, LÝ, HÓA, ANH)
-- Chạy tự động sau 01_schema.sql trong PostgreSQL 16+ (Idempotent 100%)
-- ============================================================================

-- 1. Danh mục Trường học Demo (THPT, THCS, Tiểu học)
INSERT INTO schools (id, code, name, level, address, is_active)
VALUES
    ('11111111-1111-4111-8111-111111111101', 'THPT_LHP', 'Trường THPT Chuyên Lê Hồng Phong', 'THPT', '235 Nguyễn Văn Cừ, Quận 5, TP.HCM', TRUE),
    ('11111111-1111-4111-8111-111111111102', 'THCS_NTP', 'Trường THCS Nguyễn Tri Phương', 'THCS', '224 Nguyễn Tri Phương, Quận 10, TP.HCM', TRUE),
    ('11111111-1111-4111-8111-111111111103', 'TH_KD', 'Trường Tiểu học Kim Đồng', 'TIEU_HOC', '15 Trần Phú, Quận 5, TP.HCM', TRUE)
ON CONFLICT (code) DO NOTHING;

-- 2. Tài khoản Quản trị viên, Giáo viên, Học sinh và Phụ huynh Demo
-- Mật khẩu Admin: Admin@2026 | Mật khẩu GV / HS / PH Demo: Demo@2026
INSERT INTO users (id, school_id, role, full_name, email, phone, password_hash, student_code, linked_student_id, is_active)
VALUES
    -- Admin hệ thống
    ('22222222-2222-4222-8222-222222222201', NULL, 'ADMIN', 'Quản Trị Viên Hệ Thống', 'admin@aicanvas.edu.vn', '0900000001', '$2b$12$fthFuRvg/su38x3N3aVleuX0X1ykrbqvj90yeRrSFn/VRIMNVYd5m', NULL, NULL, TRUE),
    -- Giáo viên Toán & Vật lý (THPT)
    ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111101', 'TEACHER', 'Thầy Nguyễn Tuấn Khang', 'gv.toan@aicanvas.edu.vn', '0901000101', '$2b$12$2nSacxlGVvj7HpV6NHZK2.Q625QSonGGFKMr/l.EYzetTUixp2Pg.', NULL, NULL, TRUE),
    -- Giáo viên Hóa học & Tiếng Anh (THPT & THCS)
    ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111101', 'TEACHER', 'Cô Hoàng Minh Châu', 'gv.hoaanh@aicanvas.edu.vn', '0901000102', '$2b$12$2nSacxlGVvj7HpV6NHZK2.Q625QSonGGFKMr/l.EYzetTUixp2Pg.', NULL, NULL, TRUE),
    -- Giáo viên Tiểu học
    ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111103', 'TEACHER', 'Cô Trần Thanh Thảo', 'gv.tieuhoc@aicanvas.edu.vn', '0901000103', '$2b$12$2nSacxlGVvj7HpV6NHZK2.Q625QSonGGFKMr/l.EYzetTUixp2Pg.', NULL, NULL, TRUE),
    -- Học sinh Lớp 10A1 (THPT)
    ('22222222-2222-4222-8222-222222222301', '11111111-1111-4111-8111-111111111101', 'STUDENT', 'Nguyễn Minh Anh', NULL, '0912000101', '$2b$12$2nSacxlGVvj7HpV6NHZK2.Q625QSonGGFKMr/l.EYzetTUixp2Pg.', '10A1-HS-01', NULL, TRUE),
    ('22222222-2222-4222-8222-222222222302', '11111111-1111-4111-8111-111111111101', 'STUDENT', 'Trần Quốc Bảo', NULL, '0912000102', '$2b$12$2nSacxlGVvj7HpV6NHZK2.Q625QSonGGFKMr/l.EYzetTUixp2Pg.', '10A1-HS-02', NULL, TRUE),
    ('22222222-2222-4222-8222-222222222303', '11111111-1111-4111-8111-111111111101', 'STUDENT', 'Lê Thảo Vy', NULL, '0912000103', '$2b$12$2nSacxlGVvj7HpV6NHZK2.Q625QSonGGFKMr/l.EYzetTUixp2Pg.', '10A1-HS-03', NULL, TRUE),
    -- Học sinh Lớp 8A2 (THCS)
    ('22222222-2222-4222-8222-222222222304', '11111111-1111-4111-8111-111111111102', 'STUDENT', 'Phạm Khánh Vy', NULL, '0912000802', '$2b$12$2nSacxlGVvj7HpV6NHZK2.Q625QSonGGFKMr/l.EYzetTUixp2Pg.', '8A2-HS-01', NULL, TRUE),
    -- Học sinh Tiểu học 4A1 & Tài khoản Phụ huynh quản lý
    ('22222222-2222-4222-8222-222222222305', '11111111-1111-4111-8111-111111111103', 'STUDENT', 'Bé Lê Gia Hân', NULL, NULL, NULL, '4A1-HS-01', NULL, TRUE),
    ('22222222-2222-4222-8222-222222222306', '11111111-1111-4111-8111-111111111103', 'PARENT', 'Phụ huynh Bé Lê Gia Hân', NULL, '0912000401', '$2b$12$2nSacxlGVvj7HpV6NHZK2.Q625QSonGGFKMr/l.EYzetTUixp2Pg.', NULL, '22222222-2222-4222-8222-222222222305', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 3. Danh mục Lớp học Demo
INSERT INTO classes (id, school_id, name, grade, academic_year, homeroom_teacher_id, room_id)
VALUES
    ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111101', '10A1', 10, '2026-2027', '22222222-2222-4222-8222-222222222202', 'room-10a1'),
    ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111101', '12A1', 12, '2026-2027', '22222222-2222-4222-8222-222222222202', 'room-12a1'),
    ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111102', '8A2', 8, '2026-2027', '22222222-2222-4222-8222-222222222203', 'room-8a2'),
    ('33333333-3333-4333-8333-333333333304', '11111111-1111-4111-8111-111111111103', '4A1', 4, '2026-2027', '22222222-2222-4222-8222-222222222204', 'room-4a1')
ON CONFLICT (school_id, name, academic_year) DO NOTHING;

-- 4. Danh sách Học sinh theo Lớp (Class Enrollments)
INSERT INTO class_enrollments (id, class_id, student_id, total_bonus_score)
VALUES
    ('44444444-4444-4444-8444-444444444401', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222301', 3),
    ('44444444-4444-4444-8444-444444444402', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222302', 2),
    ('44444444-4444-4444-8444-444444444403', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222303', 1),
    ('44444444-4444-4444-8444-444444444404', '33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222304', 2),
    ('44444444-4444-4444-8444-444444444405', '33333333-3333-4333-8333-333333333304', '22222222-2222-4222-8222-222222222305', 2)
ON CONFLICT (class_id, student_id) DO NOTHING;

-- 5. Phiên giảng dạy Demo cho 4 môn Toán, Lý, Hóa, Anh
INSERT INTO teaching_sessions (id, session_code, room_id, class_id, teacher_id, subject, period_number, board_theme, toolbar_position, status)
VALUES
    ('55555555-5555-4555-8555-555555555501', 'DEMO-10A1-TOAN-P1', 'room-10a1', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222202', 'TOAN', 1, 'DARK', 'BOTTOM', 'ACTIVE'),
    ('55555555-5555-4555-8555-555555555502', 'DEMO-10A1-VATLY-P2', 'room-10a1', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222202', 'VAT_LY', 2, 'DARK', 'BOTTOM', 'CLOSED'),
    ('55555555-5555-4555-8555-555555555503', 'DEMO-10A1-HOAHOC-P3', 'room-10a1', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222203', 'HOA_HOC', 3, 'DARK', 'BOTTOM', 'CLOSED'),
    ('55555555-5555-4555-8555-555555555504', 'DEMO-10A1-TIENGANH-P4', 'room-10a1', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222203', 'TIENG_ANH', 4, 'LIGHT', 'BOTTOM', 'CLOSED'),
    ('55555555-5555-4555-8555-555555555505', 'DEMO-8A2-HOAHOC-P1', 'room-8a2', '33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222203', 'HOA_HOC', 1, 'DARK', 'BOTTOM', 'CLOSED'),
    ('55555555-5555-4555-8555-555555555506', 'DEMO-4A1-TOAN-P1', 'room-4a1', '33333333-3333-4333-8333-333333333304', '22222222-2222-4222-8222-222222222204', 'TOAN', 1, 'DARK', 'BOTTOM', 'CLOSED')
ON CONFLICT (session_code) DO NOTHING;

-- 6. Trang bảng vẽ mẫu (Board Pages)
INSERT INTO board_pages (id, session_id, page_number, canvas_json, recognized_latex)
VALUES
    ('66666666-6666-4666-8666-666666666601', '55555555-5555-4555-8555-555555555501', 1, '{"version":"6.7.1","background":"#0f172a","objects":[]}'::jsonb, 'y = x^2 - 4x + 3'),
    ('66666666-6666-4666-8666-666666666602', '55555555-5555-4555-8555-555555555502', 1, '{"version":"6.7.1","background":"#0f172a","objects":[]}'::jsonb, 'F = m \cdot a,\quad W_d = \frac{1}{2}mv^2'),
    ('66666666-6666-4666-8666-666666666603', '55555555-5555-4555-8555-555555555503', 1, '{"version":"6.7.1","background":"#0f172a","objects":[]}'::jsonb, '2H_2 + O_2 \xrightarrow{t^\circ} 2H_2O'),
    ('66666666-6666-4666-8666-666666666604', '55555555-5555-4555-8555-555555555504', 1, '{"version":"6.7.1","background":"#ffffff","objects":[]}'::jsonb, 'Photosynthesis: 6CO_2 + 6H_2O \rightarrow C_6H_{12}O_6 + 6O_2')
ON CONFLICT (session_id, page_number) DO NOTHING;

-- 7. Ảnh Snapshot bài giảng mẫu lưu trữ 6 tháng (Toán, Lý, Hóa, Anh)
INSERT INTO snapshots (id, session_id, class_id, teacher_id, subject, period_number, page_number, image_url, image_format, ocr_text_metadata, recognized_latex, trigger_type)
VALUES
    ('77777777-7777-4777-8777-777777777701', '55555555-5555-4555-8555-555555555501', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222202', 'TOAN', 1, 1, '/api/v1/sessions/snapshots/demo-snap-10a1-toan/image?format=webp', 'webp', 'Khảo sát hàm số bậc hai y = x^2 - 4x + 3, đỉnh I(2; -1)', 'y = x^2 - 4x + 3', 'MANUAL_SAVE'),
    ('77777777-7777-4777-8777-777777777702', '55555555-5555-4555-8555-555555555502', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222202', 'VAT_LY', 2, 1, '/api/v1/sessions/snapshots/demo-snap-10a1-vatly/image?format=webp', 'webp', 'Định luật II Newton và Động năng: F = m*a, Wd = 1/2 m v^2', 'W_d = \frac{1}{2}mv^2', 'BEFORE_CLEAR'),
    ('77777777-7777-4777-8777-777777777703', '55555555-5555-4555-8555-555555555503', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222203', 'HOA_HOC', 3, 1, '/api/v1/sessions/snapshots/demo-snap-10a1-hoahoc/image?format=webp', 'webp', 'Cấu tạo phân tử H2O, CH4 và cân bằng phản ứng oxi hóa - khử', 'CH_4 + 2O_2 \xrightarrow{t^\circ} CO_2 + 2H_2O', 'MANUAL_SAVE'),
    ('77777777-7777-4777-8777-777777777704', '55555555-5555-4555-8555-555555555504', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222203', 'TIENG_ANH', 4, 1, '/api/v1/sessions/snapshots/demo-snap-10a1-tienganh/image?format=webp', 'webp', 'Vocabulary Illustration: Photosynthesis, Solar System & Conditional Type 1', 'If + S + V(s/es), S + will + V', 'MANUAL_SAVE'),
    ('77777777-7777-4777-8777-777777777705', '55555555-5555-4555-8555-555555555505', '33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222203', 'HOA_HOC', 1, 1, '/api/v1/sessions/snapshots/demo-snap-8a2-hoahoc/image?format=webp', 'webp', 'Định luật bảo toàn khối lượng Lớp 8A2: m_A + m_B = m_C + m_D', 'm_{Fe} + m_{S} = m_{FeS}', 'MANUAL_SAVE'),
    ('77777777-7777-4777-8777-777777777706', '55555555-5555-4555-8555-555555555506', '33333333-3333-4333-8333-333333333304', '22222222-2222-4222-8222-222222222204', 'TOAN', 1, 1, '/api/v1/sessions/snapshots/demo-snap-4a1-toan/image?format=webp', 'webp', 'Toán Lớp 4A1: Chu vi và diện tích hình chữ nhật P = (a + b) x 2', 'P = (a + b) \times 2', 'MANUAL_SAVE')
ON CONFLICT (id) DO NOTHING;

-- 8. Lịch sử cộng điểm thưởng trên bảng (Score Bonus Logs)
INSERT INTO score_bonus_logs (id, session_id, class_id, student_id, teacher_id, snapshot_id, points_added, reason)
VALUES
    ('88888888-8888-4888-8888-888888888801', '55555555-5555-4555-8555-555555555501', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222301', '22222222-2222-4222-8222-222222222202', '77777777-7777-4777-8777-777777777701', 2, 'Giải đúng khảo sát parabol và tìm đỉnh I(2; -1) trên bảng'),
    ('88888888-8888-4888-8888-888888888802', '55555555-5555-4555-8555-555555555502', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222302', '22222222-2222-4222-8222-222222222202', '77777777-7777-4777-8777-777777777702', 2, 'Khoanh đúng câu trắc nghiệm Động năng và giải thích rõ đơn vị Jun'),
    ('88888888-8888-4888-8888-888888888803', '55555555-5555-4555-8555-555555555503', '33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222301', '22222222-2222-4222-8222-222222222203', '77777777-7777-4777-8777-777777777703', 1, 'Cân bằng nhanh phương trình đốt cháy metan CH4')
ON CONFLICT (id) DO NOTHING;

-- 9. Nhật ký tài nguyên AI mẫu phục vụ Dashboard Admin
INSERT INTO ai_usage_logs (id, session_id, provider, task_type, confidence_score, latency_ms)
VALUES
    ('99999999-9999-4999-8999-999999999901', '55555555-5555-4555-8555-555555555501', 'GEMINI_2_5_FLASH', 'OCR_LATEX', 98.50, 620),
    ('99999999-9999-4999-8999-999999999902', '55555555-5555-4555-8555-555555555501', 'GEMINI_2_5_FLASH', 'GRAPH_2D', 99.00, 480),
    ('99999999-9999-4999-8999-999999999903', '55555555-5555-4555-8555-555555555502', 'MATHPIX', 'OCR_LATEX', 97.20, 540),
    ('99999999-9999-4999-8999-999999999904', '55555555-5555-4555-8555-555555555503', 'GEMINI_2_5_FLASH', 'MODEL_3D', 96.80, 710),
    ('99999999-9999-4999-8999-999999999905', '55555555-5555-4555-8555-555555555504', 'GEMINI_2_5_FLASH', 'VOCAB_IMAGE', 95.40, 890)
ON CONFLICT (id) DO NOTHING;

-- 10. Ngân hàng Bộ đề mẫu 4 môn Toán, Lý, Hóa, Anh phục vụ buổi Báo cáo Demo (TF28524)
CREATE TABLE IF NOT EXISTS demo_exam_bank (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_code VARCHAR(50) UNIQUE NOT NULL,
    subject VARCHAR(50) NOT NULL CHECK (subject IN ('TOAN', 'VAT_LY', 'HOA_HOC', 'TIENG_ANH')),
    title VARCHAR(255) NOT NULL,
    grade_level VARCHAR(50) NOT NULL DEFAULT '10',
    raw_content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO demo_exam_bank (id, exam_code, subject, title, grade_level, raw_content)
VALUES
    (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
        'DEMO-EXAM-TOAN-10',
        'TOAN',
        'Đề mẫu Demo môn Toán 10 — Hàm số bậc hai, Giới hạn & Hình học',
        '10',
        E'Câu 1: Đỉnh I của đồ thị hàm số parabol y = x^2 - 4x + 3 có tọa độ là:\nA. I(-2; -1)\n*B. I(2; -1)\nC. I(2; 1)\nD. I(4; 3)\nLời giải: Hoành độ đỉnh x_I = -b/(2a) = 4/2 = 2, tung độ y_I = 2^2 - 4*2 + 3 = -1.\n\nCâu 2: Đạo hàm của hàm số y = x^2 + 3x là:\n*A. y'' = 2x + 3\nB. y'' = x + 3\nC. y'' = 2x\nD. y'' = 3x^2\nLời giải: Áp dụng quy tắc (x^n)'' = n*x^(n-1), ta được y'' = 2x + 3.\n\nCâu 3: Cho hình chóp tứ giác đều có cạnh đáy a = 4 và chiều cao h = 6. Thể tích khối chóp bằng:\nA. 96\nB. 48\n*C. 32\nD. 16\nLời giải: V = (1/3) * S_đáy * h = (1/3) * 4^2 * 6 = 32.\n\nCâu 4: Giải phương trình bậc nhất tự luận theo từng bước: 3x - 9 = 0.\nĐáp án: x = 3.'
    ),
    (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
        'DEMO-EXAM-VATLY-10',
        'VAT_LY',
        'Đề mẫu Demo môn Vật lý 10 — Động lực học & Bảo toàn cơ năng',
        '10',
        E'Câu 1: Gia tốc trọng trường g tại mặt đất xấp xỉ bằng bao nhiêu?\nA. 8.9 m/s^2\n*B. 9.8 m/s^2\nC. 12 m/s^2\nD. 1.6 m/s^2\nLời giải: Gia tốc rơi tự do tiêu chuẩn gần mặt đất là g ≈ 9.8 m/s^2.\n\nCâu 2: Công thức tính động năng của vật khối lượng m chuyển động với vận tốc v là:\n*A. Wd = 1/2 * m * v^2\nB. Wd = m * v\nC. Wd = 2 * m * v^2\nD. Wd = m * g * h\nLời giải: Động năng tỉ lệ thuận với khối lượng và bình phương vận tốc: Wd = 1/2 mv^2.\n\nCâu 3: Theo định luật II Newton, vật khối lượng m = 2 kg chịu hợp lực F = 10 N sẽ thu gia tốc:\nA. 20 m/s^2\nB. 0.2 m/s^2\n*C. 5 m/s^2\nD. 8 m/s^2\nLời giải: Áp dụng a = F / m = 10 / 2 = 5 m/s^2.\n\nCâu 4: Tự luận: Vật m = 4 kg chuyển động với vận tốc v = 5 m/s. Tính động năng của vật.\nĐáp án: Wd = 50 J.'
    ),
    (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03',
        'DEMO-EXAM-HOAHOC-10',
        'HOA_HOC',
        'Đề mẫu Demo môn Hóa học 10 — Cấu tạo phân tử, Mol & Phản ứng hóa học',
        '10',
        E'Câu 1: Phân tử khí Metan (CH4) có dạng hình học không gian nào sau đây?\nA. Đường thẳng\nB. Gấp khúc chữ V\n*C. Tứ diện đều\nD. Tam giác phẳng\nLời giải: Nguyên tử C lai hóa sp3 liên kết với 4 nguyên tử H tạo góc 109.5 độ dạng tứ diện đều.\n\nCâu 2: Đốt cháy hoàn toàn 1 mol CH4 cần tối thiểu bao nhiêu mol khí O2 (theo phương trình CH4 + 2O2 -> CO2 + 2H2O)?\nA. 1 mol\n*B. 2 mol\nC. 3 mol\nD. 4 mol\nLời giải: Tỉ lệ hệ số cân bằng n_CH4 : n_O2 = 1 : 2 nên cần 2 mol O2.\n\nCâu 3: Dung dịch có giá trị pH = 2 mang môi trường gì?\n*A. Môi trường axit mạnh\nB. Môi trường trung tính\nC. Môi trường kiềm yếu\nD. Môi trường kiềm mạnh\nLời giải: Thang pH < 7 là môi trường axit; pH = 2 thể hiện nồng độ H+ = 10^-2 M (axit mạnh).\n\nCâu 4: Tự luận: Cho 5.6 gam sắt (Fe = 56) tác dụng hết với dung dịch HCl dư. Tính số mol khí H2 thu được.\nĐáp án: n_H2 = 0.1 mol.'
    ),
    (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04',
        'DEMO-EXAM-TIENGANH-10',
        'TIENG_ANH',
        'Đề mẫu Demo môn Tiếng Anh 10 — Phonetics, Grammar & Science Vocabulary',
        '10',
        E'Question 1: Choose the word whose underlined part is pronounced differently:\nA. cat\nB. hat\n*C. car\nD. fat\nExplanation: "car" contains the long vowel /ɑː/, whereas "cat", "hat", and "fat" contain /æ/.\n\nQuestion 2: She _____ to school by bus every morning.\n*A. goes\nB. go\nC. going\nD. went\nExplanation: "every morning" indicates Present Simple tense with third-person singular subject "She" -> goes.\n\nQuestion 3: Plants use sunlight, water, and carbon dioxide to create oxygen and energy through _____.\nA. evaporation\n*B. photosynthesis\nC. gravity\nD. distillation\nExplanation: Photosynthesis is the biological process by which green plants synthesize nutrients using sunlight.\n\nQuestion 4: If it _____ sunny tomorrow, our class will visit the science museum.\nA. will be\nB. were\n*C. is\nD. had been\nExplanation: First conditional structure: If + S + V(present simple), S + will + V-infinitive.'
    )
ON CONFLICT (exam_code) DO NOTHING;
