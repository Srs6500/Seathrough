"""Push overlapping board solids apart so diagrams stay readable."""

from __future__ import annotations

from copy import deepcopy

GAP = 28.0
BOARD_W = 1000.0
BOARD_H = 700.0


def _text_bounds(node: dict) -> tuple[float, float, float, float]:
    role = node.get("role") or "body"
    size = 36.0 if role == "title" else 22.0 if role == "label" else 26.0
    text = str(node.get("text") or "")
    width = min(560.0, max(80.0, 16.0 + len(text) * size * 0.55))
    height = size + 18.0
    x = float(node.get("x") or 0)
    y = float(node.get("y") or 0) - size  # baseline → top
    return x, y, width, height


def _bounds(node: dict) -> tuple[float, float, float, float] | None:
    kind = node.get("type")
    if kind == "box":
        return (
            float(node.get("x") or 0),
            float(node.get("y") or 0),
            max(40.0, float(node.get("width") or 40)),
            max(40.0, float(node.get("height") or 40)),
        )
    if kind == "text":
        return _text_bounds(node)
    return None


def _overlaps(a: tuple[float, float, float, float], b: tuple[float, float, float, float], gap: float) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return not (ax + aw + gap <= bx or bx + bw + gap <= ax or ay + ah + gap <= by or by + bh + gap <= ay)


def _clamp(x: float, y: float, w: float, h: float) -> tuple[float, float, float, float]:
    w = min(w, BOARD_W - 16)
    h = min(h, BOARD_H - 16)
    x = max(8.0, min(x, BOARD_W - w - 8))
    y = max(8.0, min(y, BOARD_H - h - 8))
    return x, y, w, h


def _point_in(px: float, py: float, box: tuple[float, float, float, float], pad: float) -> bool:
    x, y, w, h = box
    return x - pad <= px <= x + w + pad and y - pad <= py <= y + h + pad


def resolve_overlaps(nodes: dict[str, dict]) -> dict[str, dict]:
    """Return a new node map with solids separated. Arrows move with anchors."""

    if not nodes:
        return nodes

    solids: list[tuple[str, tuple[float, float, float, float]]] = []
    for node_id, node in nodes.items():
        bounds = _bounds(node)
        if bounds is None:
            continue
        solids.append((node_id, bounds))
    solids.sort(key=lambda item: (item[1][1], item[1][0]))

    placed: list[tuple[str, tuple[float, float, float, float]]] = []
    delta: dict[str, tuple[float, float]] = {}

    for node_id, raw in solids:
        x, y, w, h = _clamp(*raw)
        guard = 0
        while guard < 40:
            guard += 1
            hit = None
            for _, other in placed:
                if _overlaps((x, y, w, h), other, GAP):
                    hit = other
                    break
            if hit is None:
                break
            hx, hy, hw, hh = hit
            below = hy + hh + GAP
            right = hx + hw + GAP
            down_cost = max(0.0, below - y)
            right_cost = max(0.0, right - x)
            if right_cost > 0 and right_cost < down_cost and right + w < BOARD_W - 8:
                x, y, w, h = _clamp(right, y, w, h)
            else:
                x, y, w, h = _clamp(x, below, w, h)
        placed.append((node_id, (x, y, w, h)))
        delta[node_id] = (x - raw[0], y - raw[1])

    out = deepcopy(nodes)
    for node_id, (dx, dy) in delta.items():
        if dx == 0 and dy == 0:
            continue
        node = out[node_id]
        node["x"] = float(node.get("x") or 0) + dx
        node["y"] = float(node.get("y") or 0) + dy

    for node_id, node in list(out.items()):
        if node.get("type") != "arrow":
            continue
        start = dict(node.get("start") or {})
        end = dict(node.get("end") or {})
        sx, sy = float(start.get("x") or 0), float(start.get("y") or 0)
        ex, ey = float(end.get("x") or 0), float(end.get("y") or 0)
        for solid_id, raw in solids:
            dx, dy = delta.get(solid_id, (0.0, 0.0))
            if dx == 0 and dy == 0:
                continue
            if _point_in(sx, sy, raw, 12):
                sx += dx
                sy += dy
            if _point_in(ex, ey, raw, 12):
                ex += dx
                ey += dy
        node["start"] = {"x": sx, "y": sy}
        node["end"] = {"x": ex, "y": ey}

    return out
