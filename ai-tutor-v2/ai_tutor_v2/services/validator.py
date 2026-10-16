"""Semantic checks that Pydantic field limits do not cover."""

from __future__ import annotations

from pydantic import ValidationError

from ai_tutor_v2.schemas.scene import MAX_BEAT_BYTES, MAX_BOARD_NODES, LessonBeat
from ai_tutor_v2.services.board import BoardState
from ai_tutor_v2.services.normalize import normalize_beat

_PATCH_FIELDS = {
    "text": {"x", "y", "text", "role"},
    "box": {"x", "y", "width", "height", "label"},
    "arrow": {"label"},
}


def _issue(issue: dict) -> str:
    location = ".".join(str(part) for part in issue.get("loc", []))
    message = issue.get("msg", "invalid")
    return f"{location}: {message}" if location else message


class SceneValidationError(Exception):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


def semantic_errors(beat: LessonBeat, board: BoardState) -> list[str]:
    errors: list[str] = []
    if len(beat.model_dump_json().encode("utf-8")) > MAX_BEAT_BYTES:
        errors.append("beat is larger than the event size limit")
        return errors

    working = board.copy()
    seen_ids = set(working.nodes)
    for index, action in enumerate(beat.board_actions):
        prefix = f"board_actions[{index}]"
        if action.type == "create":
            node_id = action.node.id
            if node_id in seen_ids:
                errors.append(f"{prefix} reuses id {node_id}")
                continue
            if len(working.nodes) >= MAX_BOARD_NODES:
                errors.append(f"{prefix} exceeds the {MAX_BOARD_NODES} node limit")
                continue
            working.apply(action)
            seen_ids.add(node_id)
            continue

        target = working.nodes.get(action.target_id)
        if target is None:
            errors.append(f"{prefix} references missing id {action.target_id}")
            continue
        if action.type == "update":
            changes = action.patch.changes()
            if not changes:
                errors.append(f"{prefix} patch is empty")
                continue
            allowed = _PATCH_FIELDS[target["type"]]
            unknown = sorted(set(changes) - allowed)
            if unknown:
                errors.append(f"{prefix} cannot change {', '.join(unknown)} on a {target['type']} node")
                continue
            preview = dict(target)
            preview.update(changes)
            if preview["type"] == "box" and (
                preview["x"] + preview["width"] > 1000 or preview["y"] + preview["height"] > 1000
            ):
                errors.append(f"{prefix} moves the box outside the board")
                continue
        if action.type == "remove":
            working.apply(action)
            seen_ids.discard(action.target_id)
            continue
        if action.type == "update":
            working.apply(action)
    return errors


def parse_beat(data: dict, board: BoardState) -> LessonBeat:
    normalized = normalize_beat(data)
    try:
        beat = LessonBeat.model_validate(normalized)
    except ValidationError as error:
        salvaged = _drop_schema_errors(normalized)
        if salvaged is None:
            raise SceneValidationError([_issue(issue) for issue in error.errors()]) from error
        beat = salvaged
    errors = semantic_errors(beat, board)
    if not errors:
        return beat
    trimmed = _drop_semantic_errors(beat, board)
    if trimmed is None:
        raise SceneValidationError(errors)
    return trimmed


def _drop_schema_errors(normalized: dict) -> LessonBeat | None:
    base = {key: normalized[key] for key in ("id", "objective", "narration") if key in normalized}
    base["evidence"] = []
    kept: list = []
    for action in normalized.get("board_actions") or []:
        try:
            LessonBeat.model_validate({**base, "board_actions": [*kept, action]})
        except ValidationError:
            continue
        kept.append(action)
    try:
        return LessonBeat.model_validate({**base, "board_actions": kept})
    except ValidationError:
        return None


def _drop_semantic_errors(beat: LessonBeat, board: BoardState) -> LessonBeat | None:
    kept = []
    for action in beat.board_actions:
        trial = beat.model_copy(update={"board_actions": [*kept, action]})
        if semantic_errors(trial, board):
            continue
        kept.append(action)
    if len(kept) == len(beat.board_actions) or (not kept and beat.board_actions):
        return None
    return beat.model_copy(update={"board_actions": kept})
