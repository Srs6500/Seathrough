"""Prompt text for AI Tutor v2. Kept out of persisted Scene IR."""

from __future__ import annotations

from ai_tutor_v2.services.normalize import clip_text
from ai_tutor_v2.services.planner import PlanHeader, PlanningContext

_EXAMPLE = """
{
  "objective": "Show how the two ideas connect",
  "narration": "One or two spoken sentences.",
  "done_after": false,
  "board_actions": [
    {"type": "create", "animation": "draw", "node": {"id": "sun", "type": "box", "x": 80, "y": 140, "width": 220, "height": 90, "label": "Sun"}},
    {"type": "create", "animation": "draw", "node": {"id": "earth", "type": "box", "x": 460, "y": 140, "width": 220, "height": 90, "label": "Earth"}},
    {"type": "create", "animation": "draw", "node": {"id": "rays", "type": "arrow", "start": {"x": 300, "y": 185}, "end": {"x": 460, "y": 185}, "label": "light"}},
    {"type": "point", "target_id": "earth", "emphasis_ms": 600}
  ]
}
""".strip()


def beat_prompt(
    context: PlanningContext,
    header: PlanHeader,
    *,
    beat_number: int,
    previous: list[dict],
    repair_errors: list[str] | None = None,
    previous_output: str | None = None,
) -> str:
    nodes = []
    for node in context.board.snapshot():
        label = node.get("label") or node.get("text") or ""
        nodes.append(f"- {node['id']} ({node.get('type', 'node')}): {clip_text(label, 80)}")
    history = []
    for item in previous[-4:]:
        history.append(f"- {item['id']}: {clip_text(item['objective'], 120)}")
    evidence = []
    for item in context.evidence[:5]:
        evidence.append(f"- {item.get('source_id', 'source')}: {clip_text(item.get('claim', ''), 200)}")
    lines = [
        "Return one JSON object for the next lesson beat. No markdown.",
        f"Title: {header.title}",
        f"Mode: {header.mode}",
        f"Learner level: {context.learner_level}",
        f"Language: {context.language}",
        f"Question: {clip_text(context.question, 1000)}",
        f"This is beat {beat_number}. Use beat-sized narration, at most 4 board actions.",
        "Coordinates are on a 0 to 1000 board. Reuse existing ids when you point, update, or remove.",
        "Create ids must be new. Allowed node types: text, box, arrow.",
        "Set done_after to true when this beat finishes the explanation.",
        "Existing board:",
        *(nodes or ["- empty"]),
        "Previous beats:",
        *(history or ["- none"]),
        "Evidence:",
        *(evidence or ["- none"]),
        "Shape:",
        _EXAMPLE,
    ]
    if context.interaction is not None:
        lines.extend(
            [
                f"Interruption kind: {context.interaction.kind}",
                f"Learner said: {clip_text(context.interaction.text or '', 500) or 'no extra text'}",
                "Refer to existing board ids when you point, update, or remove. Do not recreate those ids.",
            ]
        )
    if repair_errors:
        lines.extend(
            [
                "The previous JSON was rejected:",
                *[f"- {clip_text(error, 200)}" for error in repair_errors[:8]],
                "Previous output:",
                clip_text(previous_output or "", 1500),
                "Return a corrected JSON object only.",
            ]
        )
    return "\n".join(lines)
