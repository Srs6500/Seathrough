"""Scene IR for AI Tutor v2. The model describes a scene; it does not send executable code."""

from __future__ import annotations

import math
import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, model_validator

NODE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,40}$")
MAX_BEAT_BYTES = 16_000
MAX_BOARD_NODES = 40


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _finite(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("must be a finite number")
    return float(value)


Finite = Annotated[float, BeforeValidator(_finite)]
Unit = Annotated[Finite, Field(ge=0, le=1000)]
PositiveUnit = Annotated[Finite, Field(gt=0, le=1000)]


def _node_id(value: str) -> str:
    if not isinstance(value, str) or NODE_ID.fullmatch(value) is None:
        raise ValueError("must be a short id starting with a letter")
    return value


NodeId = Annotated[str, AfterValidator(_node_id)]


class Point(StrictModel):
    x: Unit
    y: Unit


class TextNode(StrictModel):
    id: NodeId
    type: Literal["text"] = "text"
    x: Unit
    y: Unit
    text: str = Field(min_length=1, max_length=500)
    role: Literal["title", "label", "body"] = "body"


class BoxNode(StrictModel):
    id: NodeId
    type: Literal["box"] = "box"
    x: Unit
    y: Unit
    width: PositiveUnit
    height: PositiveUnit
    label: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def fits_on_board(self) -> "BoxNode":
        if self.x + self.width > 1000 or self.y + self.height > 1000:
            raise ValueError("box must fit inside the 0–1000 board")
        return self


class ArrowNode(StrictModel):
    id: NodeId
    type: Literal["arrow"] = "arrow"
    start: Point
    end: Point
    label: str | None = Field(default=None, max_length=200)


SceneNode = Annotated[TextNode | BoxNode | ArrowNode, Field(discriminator="type")]


class NodePatch(StrictModel):
    x: Unit | None = None
    y: Unit | None = None
    text: str | None = Field(default=None, min_length=1, max_length=500)
    label: str | None = Field(default=None, max_length=200)
    width: PositiveUnit | None = None
    height: PositiveUnit | None = None
    role: Literal["title", "label", "body"] | None = None

    def changes(self) -> dict:
        return self.model_dump(exclude_none=True)


class CreateAction(StrictModel):
    type: Literal["create"] = "create"
    node: SceneNode
    animation: Literal["draw", "fade", "pop", "none"] = "draw"


class UpdateAction(StrictModel):
    type: Literal["update"] = "update"
    target_id: NodeId
    patch: NodePatch
    animation: Literal["morph", "fade", "none"] = "none"


class RemoveAction(StrictModel):
    type: Literal["remove"] = "remove"
    target_id: NodeId
    animation: Literal["fade", "none"] = "fade"


class PointAction(StrictModel):
    type: Literal["point"] = "point"
    target_id: NodeId
    emphasis_ms: int | None = Field(default=None, ge=0, le=10_000)


BoardAction = Annotated[
    CreateAction | UpdateAction | RemoveAction | PointAction,
    Field(discriminator="type"),
]


class Evidence(StrictModel):
    source_id: NodeId
    claim: str = Field(min_length=1, max_length=300)


class LessonBeat(StrictModel):
    id: NodeId
    objective: str = Field(min_length=1, max_length=200)
    narration: str = Field(min_length=1, max_length=2000)
    board_actions: list[BoardAction] = Field(default_factory=list, max_length=30)
    evidence: list[Evidence] = Field(default_factory=list, max_length=5)


class LessonPlan(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    title: str = Field(min_length=1, max_length=200)
    mode: Literal[
        "concept",
        "worked_example",
        "process",
        "comparison",
        "timeline",
        "code_walkthrough",
        "mixed",
    ] = "concept"
    beats: list[LessonBeat] = Field(min_length=1, max_length=20)
