-- ============================================================================
-- DỰ ÁN: BẢNG VẼ THÔNG MINH HỖ TRỢ GIẢNG DẠY (AI INTERACTIVE CANVAS)
-- Hệ quản trị CSDL: PostgreSQL 16+
-- Sprint 1 - Task 2: Thiết kế CSDL PostgreSQL và khởi tạo bảng
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Bảng Trường học (Schools)
CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    level VARCHAR(50) NOT NULL CHECK (level IN ('TIEU_HOC', 'THCS', 'THPT', 'LIEN_CAP')),
    address TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng Tài khoản người dùng (Users: Giáo viên, Học sinh, Phụ huynh, Admin)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'TEACHER', 'STUDENT', 'PARENT')),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255),
    student_code VARCHAR(50) UNIQUE,
    linked_student_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Ràng buộc: Mỗi học sinh tiểu học/THCS/THPT gắn duy nhất 1 tài khoản định danh
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 3. Bảng Lớp học (Classes)
CREATE TABLE IF NOT EXISTS classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 12),
    academic_year VARCHAR(20) NOT NULL DEFAULT '2026-2027',
    homeroom_teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
    room_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, name, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_classes_room_id ON classes(room_id);

-- 4. Bảng Danh sách Học sinh theo Lớp (Class Enrollments)
CREATE TABLE IF NOT EXISTS class_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_bonus_score INTEGER NOT NULL DEFAULT 0,
    enrolled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, student_id)
);

-- 5. Bảng Mã xác thực OTP (OTP Verification Codes)
CREATE TABLE IF NOT EXISTS otp_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
    otp_code VARCHAR(6) NOT NULL,
    purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('LOGIN', 'RESET_PASSWORD')),
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Bảng Phiên đăng nhập 14 ngày (Auth Sessions / Refresh Tokens - FR-AUTH-02)
CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_info VARCHAR(255),
    refresh_token_hash VARCHAR(255) NOT NULL,
    remember_device BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Bảng Phiên học tại phòng học (Teaching Sessions - Cô lập theo session_id & room_id NFR-SCALE-01)
CREATE TABLE IF NOT EXISTS teaching_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_code VARCHAR(64) UNIQUE NOT NULL,
    room_id VARCHAR(100) NOT NULL,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(50) NOT NULL CHECK (subject IN ('TOAN', 'VAT_LY', 'HOA_HOC', 'TIENG_ANH', 'SINH_HOC', 'DIA_LY', 'KHAC')),
    period_number INTEGER NOT NULL CHECK (period_number BETWEEN 1 AND 12),
    board_theme VARCHAR(20) NOT NULL DEFAULT 'DARK' CHECK (board_theme IN ('DARK', 'LIGHT')),
    toolbar_position VARCHAR(20) NOT NULL DEFAULT 'BOTTOM' CHECK (toolbar_position IN ('BOTTOM', 'LEFT', 'RIGHT')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
    started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_teaching_sessions_room ON teaching_sessions(room_id, status);
CREATE INDEX IF NOT EXISTS idx_teaching_sessions_class_date ON teaching_sessions(class_id, started_at);

-- 8. Bảng Trang bảng vẽ trong phiên học (Board Pages - FR-CAN-03)
CREATE TABLE IF NOT EXISTS board_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES teaching_sessions(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number >= 1),
    canvas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    recognized_latex TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, page_number)
);

-- 9. Bảng Lưu trữ Snapshot Bảng học (Snapshots - FR-SNAP-01, FR-SNAP-03 lưu tối thiểu 6 tháng)
CREATE TABLE IF NOT EXISTS snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES teaching_sessions(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(50) NOT NULL,
    period_number INTEGER NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    image_url TEXT NOT NULL,
    image_format VARCHAR(10) NOT NULL DEFAULT 'webp' CHECK (image_format IN ('webp', 'png')),
    ocr_text_metadata TEXT,
    recognized_latex TEXT,
    trigger_type VARCHAR(30) NOT NULL DEFAULT 'BEFORE_CLEAR' CHECK (trigger_type IN ('MANUAL_SAVE', 'BEFORE_CLEAR', 'OFFLINE_SYNC')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    retention_until TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '6 months')
);

CREATE INDEX IF NOT EXISTS idx_snapshots_class_subject_date ON snapshots(class_id, subject, created_at);

-- 10. Bảng Lịch sử cộng điểm thưởng Học sinh (Score Bonus Logs - FR-SCORE-02)
CREATE TABLE IF NOT EXISTS score_bonus_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES teaching_sessions(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    snapshot_id UUID REFERENCES snapshots(id) ON DELETE SET NULL,
    points_added INTEGER NOT NULL CHECK (points_added > 0),
    reason VARCHAR(255) DEFAULT 'Hoàn thành bài tập trên bảng',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 11. Bảng Theo dõi tài nguyên AI (AI Usage Logs - Phục vụ Admin)
CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES teaching_sessions(id) ON DELETE SET NULL,
    provider VARCHAR(30) NOT NULL CHECK (provider IN ('GEMINI_2_5_FLASH', 'MATHPIX', 'LOCAL_FALLBACK')),
    task_type VARCHAR(40) NOT NULL CHECK (task_type IN ('OCR_LATEX', 'GRAPH_2D', 'MODEL_3D', 'QUIZ_GRADE', 'VOCAB_IMAGE')),
    confidence_score NUMERIC(5,2),
    latency_ms INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
