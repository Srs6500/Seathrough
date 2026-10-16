"""Deterministic board state. Replaying the same actions always yields the same nodes."""

from __future__ import annotations

import copy

from pydantic import BaseModel

from ai_tutor_v2.schemas.scene import LessonBeat


class BoardState:
    def __init__(self, nodes: dict[str, dict] | None = None) -> None:
        self.nodes: dict[str, dict] = copy.deepcopy(nodes or {})

    def copy(self) -> "BoardState":
        return BoardState(self.nodes)

    def apply(self, action: BaseModel | dict) -> None:
        payload = action.model_dump() if isinstance(action, BaseModel) else action
        kind = payload["type"]
        if kind == "create":
            node = copy.deepcopy(payload["node"])
            self.nodes[node["id"]] = node
            return
        if kind == "update":
            self.nodes[payload["target_id"]].update(
                {key: value for key, value in payload["patch"].items() if value is not None}
            )
            return
        if kind == "remove":
            self.nodes.pop(payload["target_id"], None)
            return
        if kind == "point" and payload["target_id"] not in self.nodes:
            raise KeyError(payload["target_id"])

    def apply_beat(self, beat: LessonBeat) -> None:
        for action in beat.board_actions:
            self.apply(action)

    def snapshot(self) -> list[dict]:
        return [copy.deepcopy(self.nodes[key]) for key in sorted(self.nodes)]


def board_from_events(events, beat_id: str | None = None) -> BoardState:
    """Replay board actions through the requested beat, inclusive."""

    board = BoardState()
    for event in events:
        event_type = event.event_type if hasattr(event, "event_type") else event["event"]
        payload = event.payload if hasattr(event, "payload") else event["data"]["payload"]
        event_beat = event.beat_id if hasattr(event, "beat_id") else event["data"].get("beat_id")
        if event_type == "board.action":
            board.apply(payload)
        if beat_id and event_type == "beat.completed" and event_beat == beat_id:
            break
    return board
