import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)  # Toán, Vật lý, Tiếng Anh, Hóa học...
    code = Column(String(20), unique=True, nullable=False)  # MATH, PHYS, ENG, CHEM...
    description = Column(String(255), nullable=True)


class Classroom(Base):
    __tablename__ = "classrooms"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)  # 10A1, 12 Tin, Lớp 5B...
    grade_level = Column(String(20), nullable=False)  # 1-12
    school_year = Column(String(20), nullable=True)  # 2026-2027

    teacher_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
