import asyncio

from ai_tutor_v2.database.models import LessonVersion
from ai_tutor_v2.schemas.scene import LessonBeat
from ai_tutor_v2.services.board import BoardState
from ai_tutor_v2.services.planner import PlanHeader
from tests.sse import parse_sse


async def _finished_events(client, lesson_id: str) -> list[dict]:
    response = await client.get(f"/api/v2/lessons/{lesson_id}/events")
    events, _ = parse_sse(response.text)
    assert events[-1]["event"] in {"lesson.completed", "lesson.cancelled", "lesson.error"}
    return events


def _board(events: list[dict]) -> set[str]:
    board = BoardState()
    for event in events:
        if event["event"] == "board.action":
            board.apply(event["data"]["payload"])
    return set(board.nodes)


async def test_follow_up_branches_a_version_and_points_at_the_current_board(client, app):
    created = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    lesson_id = created.json()["lesson_id"]
    parent_id = created.json()["version_id"]
    original = await _finished_events(client, lesson_id)
    last_id = original[-1]["id"]

    follow = await client.post(
        f"/api/v2/lessons/{lesson_id}/interactions",
        json={
            "kind": "question",
            "text": "Does Earth being closer to the Sun cause summer?",
            "current_version_id": parent_id,
            "current_beat_id": "b1",
            "playback_position_ms": 6400,
        },
    )
    assert follow.status_code == 201
    body = follow.json()
    assert body["version_id"] != parent_id
    assert body["interaction_id"].startswith("int_")

    suffix_response = await client.get(
        f"/api/v2/lessons/{lesson_id}/events",
        headers={"Last-Event-ID": last_id},
    )
    suffix, _ = parse_sse(suffix_response.text)
    assert suffix
    assert all(int(event["id"]) > int(last_id) for event in suffix)
    assert suffix[-1]["event"] == "lesson.completed"
    point = next(event["data"]["payload"] for event in suffix if event["data"]["payload"].get("type") == "point")
    assert point["target_id"] == "title"

    full = await _finished_events(client, lesson_id)
    assert _board(full) >= {"title", "topic", "note_1"}
    async with app.state.session_factory() as session:
        child = await session.get(LessonVersion, body["version_id"])
    assert child is not None
    assert child.parent_version_id == parent_id


async def test_start_over_removes_existing_nodes(client):
    created = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    lesson_id = created.json()["lesson_id"]
    await _finished_events(client, lesson_id)
    restarted = await client.post(
        f"/api/v2/lessons/{lesson_id}/interactions",
        json={"kind": "start_over"},
    )
    assert restarted.status_code == 201
    events = await _finished_events(client, lesson_id)
    assert _board(events) == {"note_1"}
    assert any(event["data"]["payload"].get("type") == "remove" for event in events)


async def test_pause_and_resume_do_not_branch(client):
    created = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    lesson_id = created.json()["lesson_id"]
    version_id = created.json()["version_id"]
    original = await _finished_events(client, lesson_id)

    paused = await client.post(
        f"/api/v2/lessons/{lesson_id}/interactions",
        json={"kind": "pause", "playback_position_ms": 1200, "current_beat_id": "b1"},
    )
    assert paused.status_code == 200
    assert paused.json()["version_id"] == version_id
    assert paused.json()["status"] == "recorded"

    resumed = await client.post(
        f"/api/v2/lessons/{lesson_id}/interactions",
        json={"kind": "resume"},
    )
    assert resumed.status_code == 200
    replay = await client.get(f"/api/v2/lessons/{lesson_id}/events")
    events, _ = parse_sse(replay.text)
    kinds = [event["event"] for event in events]
    assert kinds[len(original) :] == ["lesson.paused", "lesson.resumed"]


async def test_interaction_validation(client):
    created = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    lesson_id = created.json()["lesson_id"]
    await _finished_events(client, lesson_id)

    empty = await client.post(f"/api/v2/lessons/{lesson_id}/interactions", json={"kind": "question", "text": "  "})
    assert empty.status_code == 422

    mode = await client.post(f"/api/v2/lessons/{lesson_id}/interactions", json={"kind": "change_mode"})
    assert mode.status_code == 422

    missing = await client.post("/api/v2/lessons/les_missing/interactions", json={"kind": "pause"})
    assert missing.status_code == 404

    wrong_version = await client.post(
        f"/api/v2/lessons/{lesson_id}/interactions",
        json={"kind": "simplify", "current_version_id": "ver_other"},
    )
    assert wrong_version.status_code == 422


async def test_start_over_cancels_an_in_progress_version(client, app):
    class GatePlanner:
        name = "gate"

        def __init__(self) -> None:
            self.calls = 0
            self.started = asyncio.Event()

        async def start(self, context):
            return PlanHeader(title="Gate", mode="concept")

        async def next_beat(self, context, header, previous):
            self.calls += 1
            if self.calls == 1:
                self.started.set()
                await asyncio.Event().wait()
            if previous:
                return None
            return LessonBeat(id="b1", objective="Continue", narration="Here is the restarted explanation.")

    app.state.planner_override = GatePlanner()
    created = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    lesson_id = created.json()["lesson_id"]
    old_version = created.json()["version_id"]
    await app.state.planner_override.started.wait()

    restarted = await client.post(f"/api/v2/lessons/{lesson_id}/interactions", json={"kind": "start_over"})
    assert restarted.status_code == 201
    await _finished_events(client, lesson_id)

    for _ in range(50):
        async with app.state.session_factory() as session:
            version = await session.get(LessonVersion, old_version)
        if version is not None and version.status == "cancelled":
            break
        await asyncio.sleep(0.02)
    else:
        raise AssertionError("the in-progress version was not cancelled")

    async with app.state.session_factory() as session:
        lesson_version = await session.get(LessonVersion, restarted.json()["version_id"])
        current = await session.get(LessonVersion, old_version)
    assert lesson_version is not None and lesson_version.status == "completed"
    assert current is not None and current.status == "cancelled"
