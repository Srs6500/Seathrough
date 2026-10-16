"""Append-only lesson events. Sequence numbers are unique per lesson."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_tutor_v2.database.models import Lesson, LessonEvent, LessonVersion

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


@dataclass(frozen=True)
class StoredEvent:
    lesson_id: str
    version_id: str
    sequence: int
    event_type: str
    beat_id: str | None
    payload: dict


def event_data(event: StoredEvent) -> dict:
    return {
        "lesson_id": event.lesson_id,
        "version_id": event.version_id,
        "seq": event.sequence,
        "beat_id": event.beat_id,
        "payload": event.payload,
    }


def format_sse(event: StoredEvent) -> str:
    import json

    data = json.dumps(event_data(event), separators=(",", ":"), ensure_ascii=False)
    return f"id: {event.sequence}\nevent: {event.event_type}\ndata: {data}\n\n"


async def append_event(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    lesson_id: str,
    version_id: str,
    event_type: str,
    payload: dict,
    beat_id: str | None = None,
    status: str | None = None,
    mutate: Callable[[Lesson, LessonVersion], None] | None = None,
) -> StoredEvent:
    async with session_factory() as session:
        async with session.begin():
            lesson = await session.get(Lesson, lesson_id, with_for_update=True)
            version = await session.get(LessonVersion, version_id, with_for_update=True)
            if lesson is None or version is None:
                raise LookupError(lesson_id)
            lesson.last_sequence += 1
            now = datetime.now(timezone.utc)
            lesson.updated_at = now
            version.updated_at = now
            if status is not None:
                version.status = status
                if lesson.current_version_id == version_id:
                    lesson.status = status
            if mutate is not None:
                mutate(lesson, version)
            event = LessonEvent(
                lesson_id=lesson_id,
                version_id=version_id,
                sequence=lesson.last_sequence,
                event_type=event_type,
                beat_id=beat_id,
                payload=payload,
                created_at=now,
            )
            session.add(event)
            stored = StoredEvent(
                lesson_id=lesson_id,
                version_id=version_id,
                sequence=lesson.last_sequence,
                event_type=event_type,
                beat_id=beat_id,
                payload=payload,
            )
    return stored


async def events_after(
    session_factory: async_sessionmaker[AsyncSession],
    lesson_id: str,
    sequence: int,
) -> list[StoredEvent]:
    async with session_factory() as session:
        result = await session.execute(
            select(LessonEvent)
            .where(LessonEvent.lesson_id == lesson_id, LessonEvent.sequence > sequence)
            .order_by(LessonEvent.sequence)
        )
        return [
            StoredEvent(
                lesson_id=row.lesson_id,
                version_id=row.version_id,
                sequence=row.sequence,
                event_type=row.event_type,
                beat_id=row.beat_id,
                payload=row.payload,
            )
            for row in result.scalars()
        ]


async def lesson_status(session_factory: async_sessionmaker[AsyncSession], lesson_id: str) -> str | None:
    async with session_factory() as session:
        lesson = await session.get(Lesson, lesson_id)
        return None if lesson is None else lesson.status


def transcript_from(events: list[StoredEvent]) -> list[dict]:
    items: list[dict] = []
    current: dict | None = None
    for event in events:
        if event.event_type == "beat.started":
            current = {
                "beat_id": event.beat_id,
                "objective": event.payload.get("objective", ""),
                "narration": "",
            }
            items.append(current)
        elif event.event_type == "narration.text" and current is not None and current["beat_id"] == event.beat_id:
            current["narration"] = event.payload.get("text", "")
    return items
