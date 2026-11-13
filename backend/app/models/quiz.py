import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Float
from app.core.database import Base


class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(200), nullable=False)
    subject_id = Column(String(36), ForeignKey("subjects.id"), nullable=False)
    teacher_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    difficulty = Column(String(20), default="MEDIUM")  # EASY, MEDIUM, HARD
    source_type = Column(String(50), default="MANUAL")  # MANUAL, DOCX, PDF, AI_GEN
    created_at = Column(DateTime, default=datetime.utcnow)


class Question(Base):
    __tablename__ = "questions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    quiz_id = Column(String(36), ForeignKey("quizzes.id"), nullable=False)
    content = Column(Text, nullable=False)  # Markdown or text
    question_type = Column(String(20), default="MCQ")  # MCQ (trắc nghiệm) or ESSAY (tự luận)
    explanation = Column(Text, nullable=True)  # Detailed explanation why answer is correct
    created_at = Column(DateTime, default=datetime.utcnow)


class AnswerOption(Base):
    __tablename__ = "answer_options"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    question_id = Column(String(36), ForeignKey("questions.id"), nullable=False)
    label = Column(String(10), nullable=False)  # A, B, C, D
    content = Column(Text, nullable=False)
    is_correct = Column(Boolean, default=False)
    wrong_explanation = Column(Text, nullable=True)  # Analysis why this distractor is wrong


class StudentAnswer(Base):
    __tablename__ = "student_answers"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("board_sessions.id"), nullable=False)
    student_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    question_id = Column(String(36), ForeignKey("questions.id"), nullable=False)
    selected_option_id = Column(String(36), ForeignKey("answer_options.id"), nullable=True)
    written_answer = Column(Text, nullable=True)  # Handwriting transcription
    is_correct = Column(Boolean, default=False)
    ai_feedback = Column(Text, nullable=True)
    score = Column(Float, default=0.0)
    submitted_at = Column(DateTime, default=datetime.utcnow)
