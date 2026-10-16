"""PostgreSQL tables for AI Tutor v2 lessons.

Event sequence numbers are unique per lesson, not restarted per version, so
Last-Event-ID still resumes one stream after a follow-up branches a version.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ai_tutor_v2.database.base import Base

LESSON_STATUSES = ("generating", "completed", "failed", "cancelled", "paused")
_STATUS_CHECK = "status IN ('generating', 'completed', 'failed', 'cancelled', 'paused')"


class Lesson(Base):
    __tablename__ = "lessons"
    __table_args__ = (CheckConstraint(_STATUS_CHECK, name="ck_lessons_status"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="generating")
    mode: Mapped[str | None] = mapped_column(String(32))
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    learner_level: Mapped[str] = mapped_column(String(32), nullable=False, default="beginner")
    preferences: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    current_version_id: Mapped[str | None] = mapped_column(String(32))
    last_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LessonVersion(Base):
    __tablename__ = "lesson_versions"
    __table_args__ = (
        CheckConstraint(_STATUS_CHECK, name="ck_lesson_versions_status"),
        Index("ix_lesson_versions_lesson", "lesson_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    parent_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("lesson_versions.id", ondelete="SET NULL")
    )
    schema_version: Mapped[str] = mapped_column(String(16), nullable=False, default="1.0")
    planner: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="generating")
    plan: Mapped[dict | None] = mapped_column(JSONB)
    model_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LessonEvent(Base):
    __tablename__ = "lesson_events"
    __table_args__ = (
        UniqueConstraint("lesson_id", "sequence", name="uq_lesson_events_sequence"),
        Index("ix_lesson_events_replay", "lesson_id", "version_id", "sequence"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[str] = mapped_column(
        ForeignKey("lesson_versions.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    beat_id: Mapped[str | None] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LessonInteraction(Base):
    __tablename__ = "lesson_interactions"
    __table_args__ = (Index("ix_lesson_interactions_lesson", "lesson_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    text: Mapped[str | None] = mapped_column(Text)
    mode: Mapped[str | None] = mapped_column(String(32))
    from_version_id: Mapped[str | None] = mapped_column(String(32))
    beat_id: Mapped[str | None] = mapped_column(String(64))
    playback_position_ms: Mapped[int | None] = mapped_column(Integer)
    resulting_version_id: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ToolRun(Base):
    __tablename__ = "tool_runs"
    __table_args__ = (Index("ix_tool_runs_lesson", "lesson_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[str | None] = mapped_column(ForeignKey("lesson_versions.id", ondelete="CASCADE"))
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    evidence_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LessonFeedback(Base):
    __tablename__ = "lesson_feedback"
    __table_args__ = (Index("ix_lesson_feedback_lesson", "lesson_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[str | None] = mapped_column(String(32))
    beat_id: Mapped[str | None] = mapped_column(String(64))
    node_id: Mapped[str | None] = mapped_column(String(64))
    rating: Mapped[str | None] = mapped_column(String(32))
    category: Mapped[str | None] = mapped_column(String(64))
    text: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
