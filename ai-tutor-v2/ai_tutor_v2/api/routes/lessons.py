"""Lesson create, read, replay, and feedback routes for AI Tutor v2."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select

from ai_tutor_v2.database.models import Lesson, LessonFeedback, LessonInteraction, LessonVersion
from ai_tutor_v2.ids import new_id
from ai_tutor_v2.log import log_event
from ai_tutor_v2.schemas.api import (
    CreateLessonIn,
    FeedbackIn,
    FeedbackOut,
    InteractionIn,
    InteractionOut,
    LessonCreatedOut,
    LessonOut,
    TranscriptBeatOut,
)
from ai_tutor_v2.services.board import board_from_events
from ai_tutor_v2.services.limits import RateLimiter
from ai_tutor_v2.services.orchestrator import run_generation
from ai_tutor_v2.services.model_planner import build_planner
from ai_tutor_v2.services.planner import InteractionHint
from ai_tutor_v2.services.store import (
    TERMINAL_STATUSES,
    append_event,
    events_after,
    format_sse,
    lesson_status,
    transcript_from,
)

router = APIRouter(prefix="/api/v2", tags=["lessons"])


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "anonymous"


def _limiter(request: Request) -> RateLimiter:
    return request.app.state.limiter


def _planner(request: Request):
    override = getattr(request.app.state, "planner_override", None)
    return override if override is not None else build_planner(request.app.state.settings)


def _cursor(request: Request, cursor: int | None) -> int:
    if cursor is not None:
        if cursor < 0:
            raise HTTPException(status_code=422, detail="cursor must be zero or greater.")
        return cursor
    header = request.headers.get("last-event-id")
    if header is None or header == "":
        return 0
    if not header.isdigit():
        raise HTTPException(status_code=422, detail="Last-Event-ID must be a sequence number.")
    return int(header)


async def _require_lesson(session, lesson_id: str) -> Lesson:
    lesson = await session.get(Lesson, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found.")
    return lesson


@router.post("/lessons", status_code=201, response_model=LessonCreatedOut)
async def create_lesson(body: CreateLessonIn, request: Request) -> LessonCreatedOut:
    settings = request.app.state.settings
    if len(body.question) > settings.max_question_chars:
        raise HTTPException(status_code=422, detail="The question is too long.")
    if not _limiter(request).allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail="Too many lesson requests. Try again in a minute.",
            headers={"Retry-After": "60"},
        )

    planner = _planner(request)
    lesson_id = new_id("les")
    version_id = new_id("ver")
    now = datetime.now(timezone.utc)
    lesson = Lesson(
        id=lesson_id,
        question=body.question,
        status="generating",
        mode=body.preferences.mode,
        language=body.learner.language,
        learner_level=body.learner.level,
        preferences=body.preferences.model_dump(mode="json"),
        current_version_id=version_id,
        last_sequence=0,
        created_at=now,
        updated_at=now,
    )
    version = LessonVersion(
        id=version_id,
        lesson_id=lesson_id,
        schema_version="1.0",
        planner=getattr(planner, "name", "fake"),
        status="generating",
        model_metadata={},
        created_at=now,
        updated_at=now,
    )
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        session.add(lesson)
        session.add(version)
        await session.commit()

    log_event(
        logging.INFO,
        "lesson.requested",
        lesson_id=lesson_id,
        version_id=version_id,
        question_len=len(body.question),
        planner=version.planner,
    )
    cancel = request.app.state.generations.cancel_event(version_id)
    task = asyncio.create_task(
        run_generation(
            settings=settings,
            session_factory=session_factory,
            bus=request.app.state.bus,
            planner=planner,
            lesson_id=lesson_id,
            version_id=version_id,
            cancel=cancel,
        )
    )
    request.app.state.generations.track(version_id, task)
    return LessonCreatedOut(
        lesson_id=lesson_id,
        version_id=version_id,
        status="generating",
        events_url=f"/api/v2/lessons/{lesson_id}/events",
    )


@router.get("/lessons/{lesson_id}", response_model=LessonOut)
async def get_lesson(lesson_id: str, request: Request) -> LessonOut:
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        lesson = await _require_lesson(session, lesson_id)
        version = None
        if lesson.current_version_id:
            version = await session.get(LessonVersion, lesson.current_version_id)
        snapshot = {
            "lesson_id": lesson.id,
            "version_id": lesson.current_version_id,
            "status": lesson.status,
            "title": lesson.title,
            "question": lesson.question,
            "mode": lesson.mode,
            "schema_version": version.schema_version if version is not None else "1.0",
            "language": lesson.language,
            "learner_level": lesson.learner_level,
            "created_at": lesson.created_at.isoformat(),
            "updated_at": lesson.updated_at.isoformat(),
        }
    events = await events_after(session_factory, lesson_id, 0)
    snapshot["transcript"] = [TranscriptBeatOut.model_validate(item) for item in transcript_from(events)]
    return LessonOut.model_validate(snapshot)


@router.get("/lessons/{lesson_id}/events")
async def stream_events(lesson_id: str, request: Request, cursor: int | None = None):
    start = _cursor(request, cursor)
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        await _require_lesson(session, lesson_id)
    heartbeat = request.app.state.settings.heartbeat_interval_s
    bus = request.app.state.bus

    async def generate():
        position = start
        while True:
            if await request.is_disconnected():
                return
            rows = await events_after(session_factory, lesson_id, position)
            for row in rows:
                position = row.sequence
                yield format_sse(row)
            if rows:
                continue
            status = await lesson_status(session_factory, lesson_id)
            if status in TERMINAL_STATUSES:
                rows = await events_after(session_factory, lesson_id, position)
                for row in rows:
                    position = row.sequence
                    yield format_sse(row)
                if not rows:
                    return
                continue
            notified = await bus.wait(lesson_id, heartbeat)
            if not notified:
                yield ": heartbeat\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/lessons/{lesson_id}/feedback", status_code=201, response_model=FeedbackOut)
async def create_feedback(lesson_id: str, body: FeedbackIn, request: Request) -> FeedbackOut:
    if not _limiter(request).allow(f"feedback:{_client_key(request)}"):
        raise HTTPException(
            status_code=429,
            detail="Too many feedback requests. Try again in a minute.",
            headers={"Retry-After": "60"},
        )
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        lesson = await _require_lesson(session, lesson_id)
        if body.version_id is not None:
            version = await session.get(LessonVersion, body.version_id)
            if version is None or version.lesson_id != lesson.id:
                raise HTTPException(status_code=422, detail="That version is not part of this lesson.")
        if body.beat_id is not None:
            found = await session.execute(
                select(LessonVersion.id).where(LessonVersion.lesson_id == lesson.id)
            )
            version_ids = {row[0] for row in found.all()}
            if not version_ids:
                raise HTTPException(status_code=422, detail="That beat is not part of this lesson.")
        events = await events_after(session_factory, lesson_id, 0) if body.beat_id else []
        if body.beat_id is not None and not any(event.beat_id == body.beat_id for event in events):
            raise HTTPException(status_code=422, detail="That beat is not part of this lesson.")
        feedback = LessonFeedback(
            id=new_id("fb"),
            lesson_id=lesson.id,
            version_id=body.version_id or lesson.current_version_id,
            beat_id=body.beat_id,
            node_id=body.node_id,
            rating=body.rating,
            category=body.category,
            text=body.text,
            created_at=datetime.now(timezone.utc),
        )
        session.add(feedback)
        await session.commit()
        feedback_id = feedback.id
    log_event(logging.INFO, "lesson.feedback", lesson_id=lesson_id, rating=body.rating or "")
    return FeedbackOut(feedback_id=feedback_id, lesson_id=lesson_id)


_BRANCH_KINDS = {"question", "repeat", "simplify", "give_example", "change_mode", "start_over"}


def _launch(request: Request, *, lesson_id: str, version_id: str, interaction: InteractionHint | None, board, clear_node_ids: list[str]) -> None:
    cancel = request.app.state.generations.cancel_event(version_id)
    task = asyncio.create_task(
        run_generation(
            settings=request.app.state.settings,
            session_factory=request.app.state.session_factory,
            bus=request.app.state.bus,
            planner=_planner(request),
            lesson_id=lesson_id,
            version_id=version_id,
            cancel=cancel,
            interaction=interaction,
            board=board,
            clear_node_ids=clear_node_ids,
        )
    )
    request.app.state.generations.track(version_id, task)


@router.post("/lessons/{lesson_id}/interactions", response_model=InteractionOut)
async def create_interaction(lesson_id: str, body: InteractionIn, request: Request):
    if not _limiter(request).allow(f"interaction:{_client_key(request)}"):
        raise HTTPException(
            status_code=429,
            detail="Too many lesson requests. Try again in a minute.",
            headers={"Retry-After": "60"},
        )
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        lesson = await _require_lesson(session, lesson_id)
        version_id = body.current_version_id or lesson.current_version_id
        if version_id is not None:
            version = await session.get(LessonVersion, version_id)
            if version is None or version.lesson_id != lesson.id:
                raise HTTPException(status_code=422, detail="That version is not part of this lesson.")
        if body.kind not in _BRANCH_KINDS:
            if version_id is None:
                raise HTTPException(status_code=409, detail="The lesson has no version to pause.")
            interaction_id = new_id("int")
            session.add(
                LessonInteraction(
                    id=interaction_id,
                    lesson_id=lesson.id,
                    kind=body.kind,
                    text=body.text,
                    mode=body.mode,
                    from_version_id=version_id,
                    beat_id=body.current_beat_id,
                    playback_position_ms=body.playback_position_ms,
                    resulting_version_id=version_id,
                    created_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()
    if body.kind not in _BRANCH_KINDS:
        await append_event(
            session_factory,
            lesson_id=lesson.id,
            version_id=version_id,
            event_type="lesson.paused" if body.kind == "pause" else "lesson.resumed",
            payload={"playback_position_ms": body.playback_position_ms, "beat_id": body.current_beat_id},
        )
        await request.app.state.bus.publish(lesson.id)
        recorded = InteractionOut(
            interaction_id=interaction_id,
            lesson_id=lesson.id,
            version_id=version_id,
            status="recorded",
            events_url=f"/api/v2/lessons/{lesson.id}/events",
        )
        return JSONResponse(status_code=200, content=recorded.model_dump())

    history = await events_after(session_factory, lesson.id, 0)
    board = board_from_events(history, body.current_beat_id)
    clear_node_ids = list(board.nodes) if body.kind == "start_over" else []
    planner_board = board if body.kind != "start_over" else None
    new_version_id = new_id("ver")
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        lesson = await _require_lesson(session, lesson_id)
        previous_version_id = lesson.current_version_id
        if body.mode is not None:
            lesson.mode = body.mode
            lesson.preferences = {**(lesson.preferences or {}), "mode": body.mode}
        lesson.current_version_id = new_version_id
        lesson.status = "generating"
        lesson.updated_at = now
        session.add(
            LessonVersion(
                id=new_version_id,
                lesson_id=lesson.id,
                parent_version_id=previous_version_id,
                schema_version="1.0",
                planner=getattr(_planner(request), "name", "fake"),
                status="generating",
                model_metadata={"interaction": body.kind},
                created_at=now,
                updated_at=now,
            )
        )
        interaction_id = new_id("int")
        session.add(
            LessonInteraction(
                id=interaction_id,
                lesson_id=lesson.id,
                kind=body.kind,
                text=body.text,
                mode=body.mode,
                from_version_id=previous_version_id,
                beat_id=body.current_beat_id,
                playback_position_ms=body.playback_position_ms,
                resulting_version_id=new_version_id,
                created_at=now,
            )
        )
        await session.commit()
    if previous_version_id:
        request.app.state.generations.cancel(previous_version_id)
    _launch(
        request,
        lesson_id=lesson.id,
        version_id=new_version_id,
        interaction=InteractionHint(kind=body.kind, text=body.text, mode=body.mode),
        board=planner_board,
        clear_node_ids=clear_node_ids,
    )
    log_event(
        logging.INFO,
        "lesson.interaction",
        lesson_id=lesson.id,
        version_id=new_version_id,
        kind=body.kind,
    )
    return JSONResponse(
        status_code=201,
        content=InteractionOut(
            interaction_id=interaction_id,
            lesson_id=lesson.id,
            version_id=new_version_id,
            status="generating",
            events_url=f"/api/v2/lessons/{lesson.id}/events",
        ).model_dump(),
    )
