import pytest
from sqlalchemy import select

from ai_tutor_v2.database.models import ToolRun
from ai_tutor_v2.tools.calculator import CalculatorError, evaluate, expression_in
from tests.sse import parse_sse


def test_calculator_evaluates_arithmetic_and_rejects_code():
    assert evaluate("(17 * 24) + 1") == 409
    assert expression_in("What is 17 * 24?") == "17 * 24"
    assert expression_in("Why do seasons happen?") is None
    for attack in ["__import__('os')", "open('x')", "().__class__", "10 ** 100", "1 / 0", "2 ** 9"]:
        with pytest.raises(CalculatorError):
            evaluate(attack)


async def test_calculation_is_evidence_and_failure_does_not_stop_the_lesson(client, app):
    created = await client.post("/api/v2/lessons", json={"question": "What is 17 * 24?"})
    lesson_id = created.json()["lesson_id"]
    stream = await client.get(f"/api/v2/lessons/{lesson_id}/events")
    events, _ = parse_sse(stream.text)
    started = next(event for event in events if event["event"] == "beat.started")
    assert started["data"]["payload"]["evidence"][0]["claim"] == "17 * 24 = 408"
    assert events[-1]["event"] == "lesson.completed"

    failed = await client.post("/api/v2/lessons", json={"question": "What is 1 / 0?"})
    failed_id = failed.json()["lesson_id"]
    failed_stream = await client.get(f"/api/v2/lessons/{failed_id}/events")
    failed_events, _ = parse_sse(failed_stream.text)
    assert failed_events[-1]["event"] == "lesson.completed"
    assert failed_events[-1]["data"]["payload"]["degraded"] is False
    first = next(event for event in failed_events if event["event"] == "beat.started")
    assert first["data"]["payload"]["evidence"] == []

    plain = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    async with app.state.session_factory() as session:
        rows = (await session.execute(select(ToolRun).order_by(ToolRun.created_at))).scalars().all()
    by_lesson = {row.lesson_id: row for row in rows}
    assert by_lesson[lesson_id].status == "succeeded"
    assert by_lesson[lesson_id].summary == "17 * 24 = 408"
    assert "What is" not in by_lesson[lesson_id].summary
    assert by_lesson[failed_id].status == "failed"
    assert plain.json()["lesson_id"] not in by_lesson
