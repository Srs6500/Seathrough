"""Turn a planner result into validated, stored lesson events."""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_tutor_v2.config import Settings
from ai_tutor_v2.database.models import Lesson, LessonVersion
from ai_tutor_v2.log import log_event
from ai_tutor_v2.schemas.scene import LessonBeat, LessonPlan, RemoveAction
from ai_tutor_v2.services.board import BoardState
from ai_tutor_v2.services.fallback import fallback_reason, text_fallback_beat
from ai_tutor_v2.services.planner import LessonPlanner, PlanHeader, PlannedBeat, PlanningContext
from ai_tutor_v2.services.runtime import EventBus
from ai_tutor_v2.services.store import append_event
from ai_tutor_v2.services.validator import SceneValidationError, parse_beat
from ai_tutor_v2.tools.calculator import attach_calculation

PUBLIC_FAILURE = "The lesson could not be generated."


def _context_for(lesson: Lesson) -> PlanningContext:
    preferences = lesson.preferences or {}
    return PlanningContext(
        question=lesson.question,
        learner_level=lesson.learner_level,
        language=lesson.language,
        include_example=bool(preferences.get("include_example")),
        requested_mode=preferences.get("mode"),
        board=BoardState(),
    )


async def run_generation(
    *,
    settings: Settings,
    session_factory: async_sessionmaker[AsyncSession],
    bus: EventBus,
    planner: LessonPlanner,
    lesson_id: str,
    version_id: str,
    cancel: asyncio.Event,
    interaction=None,
    board: BoardState | None = None,
    clear_node_ids: list[str] | None = None,
) -> None:
    try:
        async with session_factory() as session:
            lesson = await session.get(Lesson, lesson_id)
            if lesson is None:
                return
            context = _context_for(lesson)
        if interaction is not None:
            context.interaction = interaction
        if board is not None:
            context.board = board
        await attach_calculation(
            session_factory,
            context,
            lesson_id=lesson_id,
            version_id=version_id,
        )
        await _generate(
            settings=settings,
            session_factory=session_factory,
            bus=bus,
            planner=planner,
            lesson_id=lesson_id,
            version_id=version_id,
            cancel=cancel,
            context=context,
            clear_node_ids=clear_node_ids or [],
        )
    except Exception as error:
        log_event(
            logging.ERROR,
            "lesson.generation_failed",
            lesson_id=lesson_id,
            version_id=version_id,
            error_type=type(error).__name__,
        )
        await _emit_terminal(
            session_factory,
            bus,
            lesson_id=lesson_id,
            version_id=version_id,
            event_type="lesson.error",
            payload={"message": PUBLIC_FAILURE},
            status="failed",
        )


async def _generate(
    *,
    settings: Settings,
    session_factory: async_sessionmaker[AsyncSession],
    bus: EventBus,
    planner: LessonPlanner,
    lesson_id: str,
    version_id: str,
    cancel: asyncio.Event,
    context: PlanningContext,
    clear_node_ids: list[str],
) -> None:
    header = await _wait_or_cancel(cancel, planner.start(context))
    if header is None:
        await _emit_terminal(
            session_factory,
            bus,
            lesson_id=lesson_id,
            version_id=version_id,
            event_type="lesson.cancelled",
            payload={"message": "Lesson generation was cancelled."},
            status="cancelled",
        )
        return

    fallbacks: list[dict] = []
    await _emit(
        session_factory,
        bus,
        lesson_id=lesson_id,
        version_id=version_id,
        event_type="lesson.started",
        payload={"schema_version": "1.0", "question": context.question},
    )
    await _emit(
        session_factory,
        bus,
        lesson_id=lesson_id,
        version_id=version_id,
        event_type="lesson.plan",
        payload={"title": header.title, "mode": header.mode, "schema_version": "1.0"},
        mutate=lambda lesson, version: _set_header(lesson, version, header),
    )

    beats: list[LessonBeat] = []
    if clear_node_ids:
        await _emit_reset(
            session_factory,
            bus,
            lesson_id=lesson_id,
            version_id=version_id,
            node_ids=clear_node_ids,
        )
    while len(beats) < settings.max_beats:
        if cancel.is_set():
            await _emit_terminal(
                session_factory,
                bus,
                lesson_id=lesson_id,
                version_id=version_id,
                event_type="lesson.cancelled",
                payload={"message": "Lesson generation was cancelled."},
                status="cancelled",
                mutate=lambda lesson, version: _save_plan(lesson, version, header, beats, fallbacks, planner),
            )
            return
        drafted = await _wait_or_cancel(cancel, planner.next_beat(context, header, beats))
        if drafted is None and cancel.is_set():
            await _emit_terminal(
                session_factory,
                bus,
                lesson_id=lesson_id,
                version_id=version_id,
                event_type="lesson.cancelled",
                payload={"message": "Lesson generation was cancelled."},
                status="cancelled",
                mutate=lambda lesson, version: _save_plan(lesson, version, header, beats, fallbacks, planner),
            )
            return
        if drafted is None:
            break
        planned = drafted if isinstance(drafted, PlannedBeat) else PlannedBeat(beat=drafted)
        accepted, reason = _accept_beat(planned.beat, context.board)
        if reason is None and planned.fallback_reason:
            reason = planned.fallback_reason
        if reason is not None:
            fallbacks.append({"beat_id": accepted.id, "reason": fallback_reason(reason)})
        await _emit_beat(session_factory, bus, lesson_id, version_id, accepted)
        context.board.apply_beat(accepted)
        beats.append(accepted)

    if not beats:
        accepted = text_fallback_beat(
            context.board,
            narration=f"Let's take {context.question} one piece at a time.",
            objective="Explain the question",
            beat_id="b1",
        )
        fallbacks.append({"beat_id": accepted.id, "reason": "planner returned no beats"})
        await _emit_beat(session_factory, bus, lesson_id, version_id, accepted)
        beats.append(accepted)

    await _emit_terminal(
        session_factory,
        bus,
        lesson_id=lesson_id,
        version_id=version_id,
        event_type="lesson.completed",
        payload={"beat_count": len(beats), "degraded": bool(fallbacks)},
        status="completed",
        mutate=lambda lesson, version: _save_plan(lesson, version, header, beats, fallbacks, planner),
    )


def _accept_beat(drafted: LessonBeat, board: BoardState) -> tuple[LessonBeat, str | None]:
    try:
        return parse_beat(drafted.model_dump(), board), None
    except SceneValidationError as error:
        fallback = text_fallback_beat(
            board,
            narration=drafted.narration,
            objective=drafted.objective,
            beat_id=drafted.id,
        )
        return fallback, "; ".join(error.errors)


async def _wait_or_cancel(cancel: asyncio.Event, awaitable):
    task = asyncio.ensure_future(awaitable)
    cancel_task = asyncio.create_task(cancel.wait())
    done, _pending = await asyncio.wait({task, cancel_task}, return_when=asyncio.FIRST_COMPLETED)
    if cancel_task in done and task not in done:
        task.cancel()
        return None
    cancel_task.cancel()
    return task.result()


async def _emit_reset(session_factory, bus, *, lesson_id: str, version_id: str, node_ids: list[str]) -> None:
    for offset in range(0, len(node_ids), 30):
        chunk = node_ids[offset : offset + 30]
        beat = LessonBeat(
            id="reset" if offset == 0 else f"reset_{offset}",
            objective="Start over",
            narration="Let's start again from the beginning.",
            board_actions=[RemoveAction(target_id=node_id, animation="fade") for node_id in chunk],
        )
        await _emit_beat(session_factory, bus, lesson_id, version_id, beat)


async def _emit_beat(session_factory, bus, lesson_id: str, version_id: str, beat: LessonBeat) -> None:
    await _emit(
        session_factory,
        bus,
        lesson_id=lesson_id,
        version_id=version_id,
        event_type="beat.started",
        beat_id=beat.id,
        payload={
            "objective": beat.objective,
            "evidence": [item.model_dump() for item in beat.evidence],
        },
    )
    await _emit(
        session_factory,
        bus,
        lesson_id=lesson_id,
        version_id=version_id,
        event_type="narration.text",
        beat_id=beat.id,
        payload={"text": beat.narration},
    )
    for action in beat.board_actions:
        await _emit(
            session_factory,
            bus,
            lesson_id=lesson_id,
            version_id=version_id,
            event_type="board.action",
            beat_id=beat.id,
            payload=action.model_dump(mode="json"),
        )
    await _emit(
        session_factory,
        bus,
        lesson_id=lesson_id,
        version_id=version_id,
        event_type="beat.completed",
        beat_id=beat.id,
        payload={},
    )


def _set_header(lesson: Lesson, version: LessonVersion, header: PlanHeader) -> None:
    lesson.title = header.title
    lesson.mode = header.mode
    version.schema_version = "1.0"


def _save_plan(
    lesson: Lesson,
    version: LessonVersion,
    header: PlanHeader,
    beats: list[LessonBeat],
    fallbacks: list[dict],
    planner: LessonPlanner | None = None,
) -> None:
    if beats:
        version.plan = LessonPlan(
            schema_version="1.0",
            title=header.title,
            mode=header.mode,
            beats=beats,
        ).model_dump(mode="json")
    metadata = dict(version.model_metadata or {})
    metadata["fallbacks"] = list(fallbacks)
    metadata["degraded"] = bool(fallbacks)
    if planner is not None:
        usage = getattr(planner, "usage", None)
        if usage:
            metadata["tokens"] = usage
        model_name = getattr(planner, "model_name", None)
        if model_name:
            metadata["model"] = model_name
    version.model_metadata = metadata
    _set_header(lesson, version, header)


async def _emit(session_factory, bus: EventBus, **kwargs) -> None:
    await append_event(session_factory, **kwargs)
    await bus.publish(kwargs["lesson_id"])


async def _emit_terminal(session_factory, bus: EventBus, *, status: str, **kwargs) -> None:
    try:
        await append_event(session_factory, status=status, **kwargs)
        await bus.publish(kwargs["lesson_id"])
    except Exception as error:
        log_event(
            logging.ERROR,
            "lesson.terminal_event_failed",
            lesson_id=kwargs.get("lesson_id"),
            error_type=type(error).__name__,
        )
