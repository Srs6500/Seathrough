"""Safe text beat used when a visual action cannot be drawn."""

from __future__ import annotations

from ai_tutor_v2.schemas.scene import NODE_ID, CreateAction, LessonBeat, TextNode
from ai_tutor_v2.services.board import BoardState
from ai_tutor_v2.services.normalize import clip_text


def _fresh_id(board: BoardState, prefix: str) -> str:
    number = 1
    while f"{prefix}_{number}" in board.nodes:
        number += 1
    return f"{prefix}_{number}"


def text_fallback_beat(
    board: BoardState,
    *,
    narration: str,
    objective: str = "Explain the idea",
    beat_id: str = "fallback",
) -> LessonBeat:
    spoken = clip_text(narration, 2000) or "Here is the explanation in words."
    goal = clip_text(objective, 200) or "Explain the idea"
    node_id = _fresh_id(board, "note")
    safe_beat_id = beat_id if NODE_ID.fullmatch(beat_id) else "fallback"
    y = min(880.0, 80 + (40 * len(board.nodes)))
    return LessonBeat(
        id=safe_beat_id,
        objective=goal,
        narration=spoken,
        board_actions=[
            CreateAction(
                animation="fade",
                node=TextNode(
                    id=node_id,
                    x=80,
                    y=y,
                    text=clip_text(spoken, 240) or "Explanation",
                    role="body",
                ),
            )
        ],
        evidence=[],
    )


def fallback_reason(reason: str) -> str:
    return clip_text(reason, 200) or "unsupported visual"
