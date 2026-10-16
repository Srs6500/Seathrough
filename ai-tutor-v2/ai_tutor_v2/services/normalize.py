"""Clamp rough model coordinates before schema validation."""

from __future__ import annotations

import copy


def clip_text(value: object, limit: int) -> str:
    text = " ".join(str(value if value is not None else "").split())
    if len(text) <= limit:
        return text
    if limit <= 1:
        return text[:limit]
    return text[: limit - 1].rstrip() + "…"


def _clamp(value: object, low: float, high: float) -> object:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return max(low, min(high, float(value)))


def _fit_box(node: dict) -> None:
    for key in ("x", "y"):
        if key in node:
            node[key] = _clamp(node[key], 0, 1000)
    x = node.get("x")
    y = node.get("y")
    width = node.get("width")
    height = node.get("height")
    if isinstance(x, (int, float)) and not isinstance(x, bool) and x >= 1000:
        node["x"] = 999.0
        x = 999.0
    if isinstance(y, (int, float)) and not isinstance(y, bool) and y >= 1000:
        node["y"] = 999.0
        y = 999.0
    if isinstance(x, (int, float)) and isinstance(width, (int, float)) and not isinstance(width, bool):
        if width > 0 and x + width > 1000:
            node["width"] = 1000 - x
    if isinstance(y, (int, float)) and isinstance(height, (int, float)) and not isinstance(height, bool):
        if height > 0 and y + height > 1000:
            node["height"] = 1000 - y


def _normalize_node(node: dict) -> dict:
    cleaned = copy.deepcopy(node)
    for key in ("x", "y"):
        if key in cleaned:
            cleaned[key] = _clamp(cleaned[key], 0, 1000)
    if cleaned.get("type") == "text" and "text" in cleaned:
        cleaned["text"] = clip_text(cleaned.get("text"), 500)
    if cleaned.get("type") == "box":
        _fit_box(cleaned)
        if "label" in cleaned and cleaned["label"] is not None:
            label = clip_text(cleaned["label"], 200)
            cleaned["label"] = label or None
    if cleaned.get("type") == "arrow":
        for point_name in ("start", "end"):
            point = cleaned.get(point_name)
            if isinstance(point, dict):
                point["x"] = _clamp(point.get("x"), 0, 1000)
                point["y"] = _clamp(point.get("y"), 0, 1000)
        if "label" in cleaned and cleaned["label"] is not None:
            label = clip_text(cleaned["label"], 200)
            cleaned["label"] = label or None
    return cleaned


_BEAT_KEYS = {"id", "objective", "narration", "board_actions", "evidence"}
_ACTION_KEYS = {"type", "node", "target_id", "patch", "animation", "emphasis_ms"}
_PATCH_KEYS = {"x", "y", "text", "label", "width", "height", "role"}
_POINT_KEYS = {"x", "y"}
_NODE_KEYS = {
    "text": {"id", "type", "x", "y", "text", "role"},
    "box": {"id", "type", "x", "y", "width", "height", "label"},
    "arrow": {"id", "type", "start", "end", "label"},
}


def _rename(data: dict, aliases: dict[str, str]) -> None:
    for old, new in aliases.items():
        if old not in data:
            continue
        if new not in data:
            data[new] = data[old]
        data.pop(old, None)


def _keep(data: dict, allowed: set[str]) -> dict:
    return {key: value for key, value in data.items() if key in allowed}


def _sanitize_node(node: dict) -> dict:
    _rename(node, {"from": "start", "to": "end"})
    allowed = _NODE_KEYS.get(node.get("type"), {"id", "type"})
    cleaned = _keep(node, allowed)
    for point_name in ("start", "end"):
        point = cleaned.get(point_name)
        if isinstance(point, dict):
            cleaned[point_name] = _keep(point, _POINT_KEYS)
    return cleaned


def _sanitize_action(action: dict) -> dict:
    _rename(action, {"targetId": "target_id", "emphasisMs": "emphasis_ms"})
    if isinstance(action.get("node"), dict):
        action["node"] = _sanitize_node(action["node"])
    if isinstance(action.get("patch"), dict):
        action["patch"] = _keep(action["patch"], _PATCH_KEYS)
    return _keep(action, _ACTION_KEYS)


def _sanitize_beat(data: dict) -> dict:
    beat = copy.deepcopy(data)
    _rename(beat, {"boardActions": "board_actions"})
    beat = _keep(beat, _BEAT_KEYS)
    if not beat.get("id"):
        beat["id"] = "beat"
    actions = beat.get("board_actions")
    if isinstance(actions, list):
        beat["board_actions"] = [_sanitize_action(action) if isinstance(action, dict) else action for action in actions]
    evidence = beat.get("evidence")
    if isinstance(evidence, list):
        cleaned = []
        for item in evidence:
            if not isinstance(item, dict):
                continue
            _rename(item, {"sourceId": "source_id"})
            cleaned.append(_keep(item, {"source_id", "claim"}))
        beat["evidence"] = cleaned
    return beat


def normalize_beat(data: dict) -> dict:
    """Clamp coordinates, drop unknown fields, and shorten text to the schema limits."""

    beat = _sanitize_beat(data)
    if "objective" in beat:
        beat["objective"] = clip_text(beat.get("objective"), 200)
    if "narration" in beat:
        beat["narration"] = clip_text(beat.get("narration"), 2000)
    actions = beat.get("board_actions")
    if not isinstance(actions, list):
        return beat
    normalized_actions = []
    for action in actions:
        if not isinstance(action, dict):
            normalized_actions.append(action)
            continue
        action = copy.deepcopy(action)
        if isinstance(action.get("node"), dict):
            action["node"] = _normalize_node(action["node"])
        patch = action.get("patch")
        if isinstance(patch, dict):
            if "text" in patch and patch["text"] is not None:
                patch["text"] = clip_text(patch["text"], 500)
            if "label" in patch and patch["label"] is not None:
                label = clip_text(patch["label"], 200)
                patch["label"] = label or None
            for key in ("x", "y"):
                if key in patch:
                    patch[key] = _clamp(patch[key], 0, 1000)
        normalized_actions.append(action)
    beat["board_actions"] = normalized_actions
    evidence = beat.get("evidence")
    if isinstance(evidence, list):
        for item in evidence:
            if isinstance(item, dict) and "claim" in item:
                item["claim"] = clip_text(item.get("claim"), 300)
    return beat
