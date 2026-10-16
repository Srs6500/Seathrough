"""Create AI Tutor v2 lesson tables.

Revision ID: 001_initial
Revises:
Create Date: 2026-10-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATUS = "status IN ('generating', 'completed', 'failed', 'cancelled', 'paused')"
JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "lessons",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("mode", sa.String(length=32), nullable=True),
        sa.Column("language", sa.String(length=16), nullable=False),
        sa.Column("learner_level", sa.String(length=32), nullable=False),
        sa.Column("preferences", JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("current_version_id", sa.String(length=32), nullable=True),
        sa.Column("last_sequence", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(STATUS, name="ck_lessons_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "lesson_versions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("lesson_id", sa.String(length=32), nullable=False),
        sa.Column("parent_version_id", sa.String(length=32), nullable=True),
        sa.Column("schema_version", sa.String(length=16), nullable=False),
        sa.Column("planner", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("plan", JSONB, nullable=True),
        sa.Column("model_metadata", JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(STATUS, name="ck_lesson_versions_status"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_version_id"], ["lesson_versions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lesson_versions_lesson", "lesson_versions", ["lesson_id", "created_at"])
    op.create_table(
        "lesson_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("lesson_id", sa.String(length=32), nullable=False),
        sa.Column("version_id", sa.String(length=32), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("beat_id", sa.String(length=64), nullable=True),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["lesson_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lesson_id", "sequence", name="uq_lesson_events_sequence"),
    )
    op.create_index(
        "ix_lesson_events_replay",
        "lesson_events",
        ["lesson_id", "version_id", "sequence"],
    )
    op.create_table(
        "lesson_interactions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("lesson_id", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("mode", sa.String(length=32), nullable=True),
        sa.Column("from_version_id", sa.String(length=32), nullable=True),
        sa.Column("beat_id", sa.String(length=64), nullable=True),
        sa.Column("playback_position_ms", sa.Integer(), nullable=True),
        sa.Column("resulting_version_id", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lesson_interactions_lesson", "lesson_interactions", ["lesson_id", "created_at"])
    op.create_table(
        "tool_runs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("lesson_id", sa.String(length=32), nullable=False),
        sa.Column("version_id", sa.String(length=32), nullable=True),
        sa.Column("tool_name", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=False),
        sa.Column("evidence_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["lesson_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tool_runs_lesson", "tool_runs", ["lesson_id", "created_at"])
    op.create_table(
        "lesson_feedback",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("lesson_id", sa.String(length=32), nullable=False),
        sa.Column("version_id", sa.String(length=32), nullable=True),
        sa.Column("beat_id", sa.String(length=64), nullable=True),
        sa.Column("node_id", sa.String(length=64), nullable=True),
        sa.Column("rating", sa.String(length=32), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lesson_feedback_lesson", "lesson_feedback", ["lesson_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_lesson_feedback_lesson", table_name="lesson_feedback")
    op.drop_table("lesson_feedback")
    op.drop_index("ix_tool_runs_lesson", table_name="tool_runs")
    op.drop_table("tool_runs")
    op.drop_index("ix_lesson_interactions_lesson", table_name="lesson_interactions")
    op.drop_table("lesson_interactions")
    op.drop_index("ix_lesson_events_replay", table_name="lesson_events")
    op.drop_table("lesson_events")
    op.drop_index("ix_lesson_versions_lesson", table_name="lesson_versions")
    op.drop_table("lesson_versions")
    op.drop_table("lessons")
