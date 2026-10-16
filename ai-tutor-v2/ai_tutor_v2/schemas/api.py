"""HTTP bodies for AI Tutor v2. Scene IR stays in schemas.scene."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from ai_tutor_v2.schemas.scene import StrictModel

Level = Literal["beginner", "intermediate", "advanced"]
Mode = Literal[
    "concept",
    "worked_example",
    "process",
    "comparison",
    "timeline",
    "code_walkthrough",
    "mixed",
]
Rating = Literal["helpful", "too_fast", "diagram_unclear", "other"]


class LearnerIn(StrictModel):
    level: Level = "beginner"
    language: str = Field(default="en", pattern=r"^[A-Za-z]{2}(-[A-Za-z0-9]{2,8})?$")


class PreferencesIn(StrictModel):
    mode: Mode | None = None
    include_example: bool = False


class CreateLessonIn(StrictModel):
    question: str = Field(min_length=1, max_length=4_000)
    learner: LearnerIn = Field(default_factory=LearnerIn)
    preferences: PreferencesIn = Field(default_factory=PreferencesIn)

    @field_validator("question", mode="before")
    @classmethod
    def strip_question(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class FeedbackIn(StrictModel):
    rating: Rating | None = None
    category: str | None = Field(default=None, max_length=64)
    text: str | None = Field(default=None, max_length=2_000)
    beat_id: str | None = Field(default=None, max_length=64)
    node_id: str | None = Field(default=None, max_length=64)
    version_id: str | None = Field(default=None, max_length=32)

    @field_validator("text", "category", mode="before")
    @classmethod
    def strip_optional(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @model_validator(mode="after")
    def needs_a_signal(self) -> "FeedbackIn":
        if self.rating is None and not self.text:
            raise ValueError("provide a rating or some text")
        return self


class LessonCreatedOut(StrictModel):
    lesson_id: str
    version_id: str
    status: str
    events_url: str


class TranscriptBeatOut(StrictModel):
    beat_id: str | None
    objective: str
    narration: str


class LessonOut(StrictModel):
    lesson_id: str
    version_id: str | None
    status: str
    title: str | None
    question: str
    mode: str | None
    schema_version: str
    language: str
    learner_level: str
    transcript: list[TranscriptBeatOut]
    created_at: str
    updated_at: str


class FeedbackOut(StrictModel):
    feedback_id: str
    lesson_id: str


InteractionKind = Literal[
    "question",
    "pause",
    "resume",
    "repeat",
    "simplify",
    "give_example",
    "change_mode",
    "start_over",
]


class InteractionIn(StrictModel):
    kind: InteractionKind
    text: str | None = Field(default=None, max_length=4_000)
    mode: Mode | None = None
    current_version_id: str | None = Field(default=None, max_length=32)
    current_beat_id: str | None = Field(default=None, max_length=64)
    playback_position_ms: int | None = Field(default=None, ge=0, le=86_400_000)

    @field_validator("text", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @model_validator(mode="after")
    def kind_requirements(self) -> "InteractionIn":
        if self.kind == "question" and not self.text:
            raise ValueError("a question needs text")
        if self.kind == "change_mode" and self.mode is None:
            raise ValueError("change_mode needs a mode")
        return self


class InteractionOut(StrictModel):
    interaction_id: str
    lesson_id: str
    version_id: str
    status: str
    events_url: str
