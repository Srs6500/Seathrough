"""Planner interface and the deterministic fake planner.

The fake planner returns the same Scene IR contract a model planner must return.
It does not call a model.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ai_tutor_v2.schemas.scene import (
    ArrowNode,
    BoxNode,
    CreateAction,
    Evidence,
    LessonBeat,
    LessonPlan,
    Point,
    PointAction,
    TextNode,
)
from ai_tutor_v2.services.board import BoardState
from ai_tutor_v2.services.normalize import clip_text

MODES = {
    "concept",
    "worked_example",
    "process",
    "comparison",
    "timeline",
    "code_walkthrough",
    "mixed",
}


@dataclass
class InteractionHint:
    kind: str
    text: str | None = None
    mode: str | None = None


@dataclass
class PlanHeader:
    title: str
    mode: str


@dataclass
class PlannedBeat:
    beat: LessonBeat
    fallback_reason: str | None = None


@dataclass
class PlanningContext:
    question: str
    learner_level: str = "beginner"
    language: str = "en"
    include_example: bool = False
    requested_mode: str | None = None
    interaction: InteractionHint | None = None
    board: BoardState = field(default_factory=BoardState)
    evidence: list[dict] = field(default_factory=list)


class LessonPlanner(Protocol):
    name: str

    async def start(self, context: PlanningContext) -> PlanHeader: ...

    async def next_beat(
        self,
        context: PlanningContext,
        header: PlanHeader,
        previous: list[LessonBeat],
    ) -> LessonBeat | None: ...


def plan_from_beats(header: PlanHeader, beats: list[LessonBeat]) -> LessonPlan:
    return LessonPlan(schema_version="1.0", title=header.title, mode=header.mode, beats=beats)


class FakeLessonPlanner:
    name = "fake"

    async def start(self, context: PlanningContext) -> PlanHeader:
        title = clip_text(context.question, 80) or "Lesson"
        mode = context.requested_mode if context.requested_mode in MODES else None
        if context.interaction and context.interaction.mode in MODES:
            mode = context.interaction.mode
        if mode is None:
            mode = "mixed" if context.include_example else "concept"
        return PlanHeader(title=title, mode=mode)

    async def next_beat(
        self,
        context: PlanningContext,
        header: PlanHeader,
        previous: list[LessonBeat],
    ) -> LessonBeat | None:
        if context.interaction is not None:
            return self._follow_up(context, previous)
        if len(previous) == 0:
            return self._introduce(context, header)
        if len(previous) == 1:
            return self._explain(context)
        if len(previous) == 2 and context.include_example:
            return self._example(context)
        return None

    def _introduce(self, context: PlanningContext, header: PlanHeader) -> LessonBeat:
        depth = "a closer look" if context.learner_level == "advanced" else "the basic idea"
        evidence = [
            Evidence(source_id=item["source_id"], claim=item["claim"])
            for item in context.evidence
            if item.get("source_id") and item.get("claim")
        ]
        return LessonBeat(
            id="b1",
            objective="Introduce the question",
            narration=f"Let's start with {depth}: {header.title}.",
            board_actions=[
                CreateAction(
                    node=TextNode(id="title", x=80, y=40, text=header.title, role="title"),
                    animation="fade",
                ),
                CreateAction(
                    node=BoxNode(id="topic", x=80, y=140, width=280, height=90, label="Topic"),
                    animation="draw",
                ),
            ],
            evidence=evidence[:5],
        )

    def _explain(self, context: PlanningContext) -> LessonBeat:
        return LessonBeat(
            id="b2",
            objective="Explain the core idea",
            narration=(
                f"The useful way to think about this is to separate what changes from what stays the same. "
                f"Question: {clip_text(context.question, 300)}"
            ),
            board_actions=[
                CreateAction(
                    node=BoxNode(id="idea", x=460, y=140, width=280, height=90, label="Core idea"),
                    animation="draw",
                ),
                CreateAction(
                    node=ArrowNode(
                        id="link",
                        start=Point(x=360, y=185),
                        end=Point(x=460, y=185),
                        label="leads to",
                    ),
                    animation="draw",
                ),
                PointAction(target_id="idea", emphasis_ms=600),
            ],
        )

    def _example(self, context: PlanningContext) -> LessonBeat:
        return LessonBeat(
            id="b3",
            objective="Show one concrete example",
            narration=f"Here is one concrete example for: {clip_text(context.question, 180)}",
            board_actions=[
                CreateAction(
                    node=TextNode(
                        id="example",
                        x=80,
                        y=280,
                        text="Example: apply the same idea to one familiar case.",
                        role="body",
                    ),
                    animation="fade",
                )
            ],
        )

    def _follow_up(self, context: PlanningContext, previous: list[LessonBeat]) -> LessonBeat | None:
        if previous:
            return None
        interaction = context.interaction
        assert interaction is not None
        existing = next(iter(sorted(context.board.nodes)), None)
        note_number = 1
        while f"note_{note_number}" in context.board.nodes:
            note_number += 1
        actions = []
        if existing is not None and interaction.kind != "start_over":
            actions.append(PointAction(target_id=existing, emphasis_ms=500))
        prompt = clip_text(interaction.text or interaction.kind, 180)
        actions.append(
            CreateAction(
                animation="fade",
                node=TextNode(
                    id=f"note_{note_number}",
                    x=80,
                    y=min(880.0, 360 + 40 * note_number),
                    text=clip_text(f"{interaction.kind}: {prompt}", 220),
                    role="body",
                ),
            )
        )
        return LessonBeat(
            id="followup",
            objective=clip_text(interaction.kind.replace("_", " "), 200),
            narration=f"Continuing from the board. {clip_text(interaction.text or 'Let us look again.', 500)}",
            board_actions=actions,
        )
