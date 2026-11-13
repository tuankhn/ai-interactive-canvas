import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer, Float
from app.core.database import Base


class BoardSession(Base):
    __tablename__ = "board_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(200), nullable=False)
    teacher_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    classroom_id = Column(String(36), ForeignKey("classrooms.id"), nullable=False)
    subject_id = Column(String(36), ForeignKey("subjects.id"), nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)


class BoardSnapshot(Base):
    __tablename__ = "board_snapshots"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("board_sessions.id"), nullable=False)
    page_number = Column(Integer, default=1)
    image_url = Column(String(500), nullable=False)  # Path or CDN/MinIO URL
    thumbnail_url = Column(String(500), nullable=True)
    ai_transcription = Column(Text, nullable=True)  # Recognized text & LaTeX metadata
    created_at = Column(DateTime, default=datetime.utcnow)


class ScoreRecord(Base):
    __tablename__ = "score_records"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    student_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    session_id = Column(String(36), ForeignKey("board_sessions.id"), nullable=False)
    bonus_points = Column(Float, default=1.0)
    reason = Column(String(255), nullable=True)
    awarded_at = Column(DateTime, default=datetime.utcnow)
