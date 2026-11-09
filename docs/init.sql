-- ==============================================================================
-- CƠ SỞ DỮ LIỆU POSTGRESQL - AI INTERACTIVE CANVAS
-- Phụ trách: Nguyễn Tuấn Khang (Leader / Fullstack)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. BẢNG NGƯỜI DÙNG (USERS)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    hashed_password VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'STUDENT', -- TEACHER, STUDENT, PARENT, ADMIN
    is_active BOOLEAN DEFAULT TRUE,
    otp_code VARCHAR(10),
    otp_expiry TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. BẢNG MÔN HỌC (SUBJECTS)
CREATE TABLE IF NOT EXISTS subjects (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description VARCHAR(255)
);

-- 3. BẢNG LỚP HỌC (CLASSROOMS)
CREATE TABLE IF NOT EXISTS classrooms (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name VARCHAR(100) NOT NULL,
    grade_level VARCHAR(20) NOT NULL,
    school_year VARCHAR(20),
    teacher_id VARCHAR(36) REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. BẢNG PHIÊN BẢNG HỌC (BOARD_SESSIONS)
CREATE TABLE IF NOT EXISTS board_sessions (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    title VARCHAR(200) NOT NULL,
    teacher_id VARCHAR(36) NOT NULL REFERENCES users(id),
    classroom_id VARCHAR(36) NOT NULL REFERENCES classrooms(id),
    subject_id VARCHAR(36) NOT NULL REFERENCES subjects(id),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP
);

-- 5. BẢNG ẢNH CHỤP BẢNG (BOARD_SNAPSHOTS)
CREATE TABLE IF NOT EXISTS board_snapshots (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    session_id VARCHAR(36) NOT NULL REFERENCES board_sessions(id) ON DELETE CASCADE,
    page_number INT DEFAULT 1,
    image_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    ai_transcription TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. BẢNG ĐIỂM THƯỞNG (SCORE_RECORDS)
CREATE TABLE IF NOT EXISTS score_records (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    student_id VARCHAR(36) NOT NULL REFERENCES users(id),
    session_id VARCHAR(36) NOT NULL REFERENCES board_sessions(id),
    bonus_points FLOAT DEFAULT 1.0,
    reason VARCHAR(255),
    awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. BẢNG ĐỀ BÀI (QUIZZES) & CÂU HỎI (QUESTIONS)
CREATE TABLE IF NOT EXISTS quizzes (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    title VARCHAR(200) NOT NULL,
    subject_id VARCHAR(36) NOT NULL REFERENCES subjects(id),
    teacher_id VARCHAR(36) NOT NULL REFERENCES users(id),
    difficulty VARCHAR(20) DEFAULT 'MEDIUM',
    source_type VARCHAR(50) DEFAULT 'MANUAL',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    quiz_id VARCHAR(36) NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    question_type VARCHAR(20) DEFAULT 'MCQ', -- MCQ, ESSAY
    explanation TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS answer_options (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    question_id VARCHAR(36) NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    label VARCHAR(10) NOT NULL, -- A, B, C, D
    content TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    wrong_explanation TEXT
);

-- DỮ LIỆU KHỞI TẠO MẪU (SEED DATA)
INSERT INTO subjects (id, name, code, description) VALUES
    ('sub-math', 'Toán Học', 'MATH', 'Đại số, Hình học phẳng, Không gian, Giải tích'),
    ('sub-phys', 'Vật Lý', 'PHYS', 'Cơ học, Nhiệt học, Quang học, Điện từ học'),
    ('sub-chem', 'Hóa Học', 'CHEM', 'Hóa vô cơ, Hóa hữu cơ, Phản ứng hóa học'),
    ('sub-eng', 'Tiếng Anh', 'ENG', 'Từ vựng, Ngữ pháp, Kỹ năng đọc viết')
ON CONFLICT (code) DO NOTHING;
