import asyncio
import json

from httpx import ASGITransport, AsyncClient

from ai_tutor_v2.config import Settings
from ai_tutor_v2.main import create_app
from ai_tutor_v2.schemas.scene import LessonBeat, PointAction
from ai_tutor_v2.services.board import BoardState
from ai_tutor_v2.services.planner import PlanHeader
from ai_tutor_v2.services.store import append_event
from tests.sse import parse_sse


async def _wait_done(client, lesson_id: str) -> dict:
    for _ in range(50):
        response = await client.get(f"/api/v2/lessons/{lesson_id}")
        body = response.json()
        if body["status"] != "generating":
            return body
        await asyncio.sleep(0.02)
    raise AssertionError("lesson stayed in generating")


def _reduce(events: list[dict]) -> list[dict]:
    board = BoardState()
    for event in events:
        if event["event"] == "board.action":
            board.apply(event["data"]["payload"])
    return board.snapshot()


async def test_create_streams_ordered_events_and_replays_the_same_board(client):
    created = await client.post(
        "/api/v2/lessons",
        json={
            "question": "  Why do seasons happen?  ",
            "learner": {"level": "advanced", "language": "en"},
            "preferences": {"include_example": False},
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "generating"
    assert body["events_url"] == f"/api/v2/lessons/{body['lesson_id']}/events"
    assert body["lesson_id"].startswith("les_")
    assert body["version_id"].startswith("ver_")

    stream = await client.get(body["events_url"])
    assert stream.status_code == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    events, _heartbeats = parse_sse(stream.text)
    sequences = [event["data"]["seq"] for event in events]
    assert sequences == list(range(1, len(events) + 1))
    assert [event["id"] for event in events] == [str(number) for number in sequences]
    assert events[0]["event"] == "lesson.started"
    assert events[1]["event"] == "lesson.plan"
    assert events[-1]["event"] == "lesson.completed"
    assert "closer look" in next(event["data"]["payload"]["text"] for event in events if event["event"] == "narration.text")

    lesson = await _wait_done(client, body["lesson_id"])
    assert lesson["status"] == "completed"
    assert lesson["question"] == "Why do seasons happen?"
    assert lesson["title"] == "Why do seasons happen?"
    assert lesson["learner_level"] == "advanced"
    assert [item["beat_id"] for item in lesson["transcript"]] == ["b1", "b2"]
    assert lesson["transcript"][0]["narration"]
    assert {node["id"] for node in _reduce(events)} == {"title", "topic", "idea", "link"}


async def test_reconnect_does_not_duplicate_board_actions(client):
    created = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    lesson_id = created.json()["lesson_id"]
    first = await client.get(f"/api/v2/lessons/{lesson_id}/events")
    events, _ = parse_sse(first.text)
    midpoint = events[len(events) // 2]
    again = await client.get(
        f"/api/v2/lessons/{lesson_id}/events",
        headers={"Last-Event-ID": midpoint["id"]},
    )
    suffix, _ = parse_sse(again.text)
    suffix_ids = [event["id"] for event in suffix]
    assert midpoint["id"] not in suffix_ids
    assert [event["id"] for event in events if int(event["id"]) > int(midpoint["id"])] == suffix_ids

    done = await client.get(
        f"/api/v2/lessons/{lesson_id}/events",
        headers={"Last-Event-ID": events[-1]["id"]},
    )
    empty, _ = parse_sse(done.text)
    assert empty == []
    prefix = [event for event in events if int(event["id"]) <= int(midpoint["id"])]
    assert _reduce(events) == _reduce(prefix + suffix)


async def test_invalid_questions_and_unknown_lessons(client):
    empty = await client.post("/api/v2/lessons", json={"question": "   "})
    assert empty.status_code == 422
    assert empty.json()["error"]["code"] == "invalid_request"
    assert "sk-" not in empty.text

    missing = await client.post("/api/v2/lessons", json={})
    assert missing.status_code == 422

    extra = await client.post("/api/v2/lessons", json={"question": "Hi", "html": "<script>"})
    assert extra.status_code == 422

    long = await client.post("/api/v2/lessons", json={"question": "a" * 4001})
    assert long.status_code == 422

    bad_level = await client.post(
        "/api/v2/lessons",
        json={"question": "Hi", "learner": {"level": "expert"}},
    )
    assert bad_level.status_code == 422

    absent = await client.get("/api/v2/lessons/les_missing")
    assert absent.status_code == 404
    assert absent.json()["error"]["message"] == "Lesson not found."

    stream = await client.get("/api/v2/lessons/les_missing/events")
    assert stream.status_code == 404

    bad_cursor = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    lesson_id = bad_cursor.json()["lesson_id"]
    await client.get(f"/api/v2/lessons/{lesson_id}/events")
    cursor = await client.get(f"/api/v2/lessons/{lesson_id}/events", headers={"Last-Event-ID": "nope"})
    assert cursor.status_code == 422


async def test_feedback_is_stored_only_for_a_real_beat(client):
    created = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    lesson_id = created.json()["lesson_id"]
    version_id = created.json()["version_id"]
    await client.get(f"/api/v2/lessons/{lesson_id}/events")

    missing = await client.post(f"/api/v2/lessons/{lesson_id}/feedback", json={})
    assert missing.status_code == 422

    unknown = await client.post(
        f"/api/v2/lessons/{lesson_id}/feedback",
        json={"rating": "helpful", "beat_id": "missing"},
    )
    assert unknown.status_code == 422

    other_lesson = await client.post("/api/v2/lessons/les_missing/feedback", json={"text": "nice"})
    assert other_lesson.status_code == 404

    saved = await client.post(
        f"/api/v2/lessons/{lesson_id}/feedback",
        json={"rating": "diagram_unclear", "text": "The arrow was hard to see.", "beat_id": "b1", "version_id": version_id},
    )
    assert saved.status_code == 201
    assert saved.json()["feedback_id"].startswith("fb_")


async def test_body_limit_and_rate_limit(database_url):
    limited = Settings(
        database_url=database_url,
        max_body_bytes=80,
        rate_limit_per_minute=2,
        database_connect_timeout_s=2,
    )
    application = create_app(limited)
    async with application.router.lifespan_context(application):
        async with application.state.engine.begin() as connection:
            from ai_tutor_v2.database.base import Base

            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        transport = ASGITransport(app=application)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            huge = await http.post("/api/v2/lessons", content=b'{"question":"' + (b"a" * 200) + b'"}')
            assert huge.status_code == 413
            assert huge.json()["error"]["code"] == "payload_too_large"

            first = await http.post("/api/v2/lessons", json={"question": "One"})
            second = await http.post("/api/v2/lessons", json={"question": "Two"})
            third = await http.post("/api/v2/lessons", json={"question": "Three"})
            assert first.status_code == 201
            assert second.status_code == 201
            assert third.status_code == 429
            assert third.headers["retry-after"] == "60"


async def test_invalid_visual_falls_back_and_secret_errors_stay_hidden(client, app):
    class BrokenPlanner:
        name = "broken"

        async def start(self, context):
            return PlanHeader(title="Broken", mode="concept")

        async def next_beat(self, context, header, previous):
            if previous:
                return None
            return LessonBeat(
                id="b1",
                objective="Point at a missing shape",
                narration="This should still be readable.",
                board_actions=[PointAction(target_id="missing")],
            )

    class ExplodingPlanner:
        name = "exploding"

        async def start(self, context):
            raise RuntimeError("provider failed sk-supersecretkeyvalue")

        async def next_beat(self, context, header, previous):
            return None

    app.state.planner_override = BrokenPlanner()
    created = await client.post("/api/v2/lessons", json={"question": "Draw something impossible"})
    stream = await client.get(created.json()["events_url"])
    events, _ = parse_sse(stream.text)
    assert events[-1]["event"] == "lesson.completed"
    assert events[-1]["data"]["payload"]["degraded"] is True
    actions = [event["data"]["payload"] for event in events if event["event"] == "board.action"]
    assert actions[0]["type"] == "create"
    assert actions[0]["node"]["type"] == "text"
    assert "missing" not in json.dumps(actions)

    app.state.planner_override = ExplodingPlanner()
    failed = await client.post("/api/v2/lessons", json={"question": "This planner crashes"})
    failure = await client.get(failed.json()["events_url"])
    failed_events, _ = parse_sse(failure.text)
    assert failed_events[-1]["event"] == "lesson.error"
    assert "sk-" not in failure.text
    assert "Traceback" not in failure.text
    lesson = await _wait_done(client, failed.json()["lesson_id"])
    assert lesson["status"] == "failed"


async def test_slow_planner_emits_a_heartbeat(client, app):
    class SlowPlanner:
        name = "slow"

        async def start(self, context):
            return PlanHeader(title="Slow", mode="concept")

        async def next_beat(self, context, header, previous):
            if previous:
                return None
            await asyncio.sleep(0.35)
            return LessonBeat(
                id="b1",
                objective="Wait",
                narration="The first beat arrives after a short pause.",
                board_actions=[],
            )

    app.state.settings.heartbeat_interval_s = 0.05
    app.state.planner_override = SlowPlanner()
    created = await client.post("/api/v2/lessons", json={"question": "Take a moment"})
    stream = await client.get(created.json()["events_url"])
    _events, heartbeats = parse_sse(stream.text)
    assert heartbeats >= 1
    assert stream.text.find(": heartbeat") < stream.text.find("event: lesson.completed")


async def test_concurrent_event_appends_stay_unique(app):
    from datetime import datetime, timezone

    from ai_tutor_v2.database.models import Lesson, LessonVersion

    now = datetime.now(timezone.utc)
    async with app.state.session_factory() as session:
        session.add(
            Lesson(
                id="les_lock",
                question="lock",
                status="generating",
                language="en",
                learner_level="beginner",
                preferences={},
                current_version_id="ver_lock",
                last_sequence=0,
                created_at=now,
                updated_at=now,
            )
        )
        session.add(
            LessonVersion(
                id="ver_lock",
                lesson_id="les_lock",
                schema_version="1.0",
                planner="fake",
                status="generating",
                model_metadata={},
                created_at=now,
                updated_at=now,
            )
        )
        await session.commit()

    async def write(name: str) -> int:
        event = await append_event(
            app.state.session_factory,
            lesson_id="les_lock",
            version_id="ver_lock",
            event_type="narration.text",
            payload={"text": name},
        )
        return event.sequence

    sequences = await asyncio.gather(write("a"), write("b"), write("c"))
    assert sorted(sequences) == [1, 2, 3]


async def test_openapi_lists_lesson_routes(client):
    response = await client.get("/openapi.json")
    paths = response.json()["paths"]
    assert "/api/v2/lessons" in paths
    assert "/api/v2/lessons/{lesson_id}" in paths
    assert "/api/v2/lessons/{lesson_id}/events" in paths
    assert "/api/v2/lessons/{lesson_id}/feedback" in paths
    assert response.json()["info"]["title"] == "SeeThrough AI Tutor v2"
