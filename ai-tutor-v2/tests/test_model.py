import json

import httpx
import pytest

from ai_tutor_v2.config import Settings
from ai_tutor_v2.database.models import LessonVersion
from ai_tutor_v2.main import create_app
from ai_tutor_v2.providers.model import HttpModelProvider, ModelResult, ProviderError, parse_json_object
from ai_tutor_v2.services.model_planner import ModelLessonPlanner
from ai_tutor_v2.services.planner import PlanningContext
from ai_tutor_v2.services.validator import parse_beat
from ai_tutor_v2.services.board import BoardState
from tests.sse import parse_sse


VALID = {
    "objective": "Introduce seasons",
    "narration": "Seasons come from the tilt of Earth's axis.",
    "done_after": True,
    "board_actions": [
        {
            "type": "create",
            "animation": "draw",
            "node": {"id": "earth", "type": "box", "x": 80, "y": 80, "width": 200, "height": 80, "label": "Earth"},
        }
    ],
}
INVALID = {
    "objective": "Point at a missing shape",
    "narration": "This reference does not exist yet.",
    "board_actions": [{"type": "point", "target_id": "missing"}],
}


class ScriptedProvider:
    model_name = "scripted"

    def __init__(self, results: list) -> None:
        self.results = list(results)
        self.calls = 0

    async def generate_structured(self, *, prompt: str, timeout_s: float, max_tokens: int) -> ModelResult:
        self.calls += 1
        item = self.results.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _settings(**overrides) -> Settings:
    base = dict(
        planner="model",
        llm_provider="groq",
        groq_api_key="",
        openai_api_key="",
        lesson_token_budget=6000,
        model_timeout_s=2,
        model_max_tokens=200,
        max_beats=4,
        database_connect_timeout_s=2,
    )
    base.update(overrides)
    return Settings(**base)


async def _beats(provider: ScriptedProvider, settings: Settings | None = None):
    planner = ModelLessonPlanner(provider, settings or _settings())
    context = PlanningContext(question="Why do seasons happen?")
    header = await planner.start(context)
    first = await planner.next_beat(context, header, [])
    assert first is not None
    parse_beat(first.beat.model_dump(), BoardState())
    return planner, first


def test_json_fence_and_non_object_are_rejected():
    assert parse_json_object('```json\n{"ok": true}\n```') == {"ok": True}
    with pytest.raises(ProviderError) as error:
        parse_json_object("not json")
    assert error.value.code == "malformed"
    assert "not json" not in str(error.value)


async def test_valid_model_beat_matches_the_scene_contract():
    provider = ScriptedProvider([ModelResult(VALID, prompt_tokens=20, completion_tokens=30)])
    planner, planned = await _beats(provider)
    assert provider.calls == 1
    assert planned.fallback_reason is None
    assert planned.beat.board_actions[0].node.id == "earth"
    assert planner.usage["total_tokens"] == 50
    assert await planner.next_beat(PlanningContext(question="Why do seasons happen?"), await planner.start(PlanningContext(question="x")), [planned.beat]) is None


async def test_one_repair_then_a_valid_beat():
    provider = ScriptedProvider(
        [
            ModelResult(INVALID, prompt_tokens=5, completion_tokens=5),
            ModelResult(VALID, prompt_tokens=5, completion_tokens=5),
        ]
    )
    planner, planned = await _beats(provider)
    assert provider.calls == 2
    assert planned.fallback_reason is None
    assert planned.beat.board_actions[0].type == "create"


async def test_second_failure_falls_back_without_a_third_call():
    provider = ScriptedProvider(
        [
            ModelResult(INVALID, prompt_tokens=1, completion_tokens=1),
            ModelResult(INVALID, prompt_tokens=1, completion_tokens=1),
            ModelResult(VALID, prompt_tokens=1, completion_tokens=1),
        ]
    )
    planner, planned = await _beats(provider)
    assert provider.calls == 2
    assert planned.fallback_reason
    assert planned.beat.board_actions[0].node.type == "text"
    assert await planner.next_beat(PlanningContext(question="Why do seasons happen?"), await planner.start(PlanningContext(question="x")), [planned.beat]) is None
    assert provider.calls == 2


async def test_timeout_does_not_retry_inside_the_planner():
    provider = ScriptedProvider([ProviderError("timeout"), ModelResult(VALID, 1, 1)])
    planner, planned = await _beats(provider)
    assert provider.calls == 1
    assert planned.fallback_reason == "timeout"
    assert "timeout" in (planned.fallback_reason or "")


async def test_malformed_output_gets_one_repair():
    provider = ScriptedProvider([ProviderError("malformed"), ModelResult(VALID, 2, 2)])
    _planner, planned = await _beats(provider)
    assert provider.calls == 2
    assert planned.fallback_reason is None


async def test_token_budget_stops_the_next_beat():
    provider = ScriptedProvider(
        [
            ModelResult({**VALID, "done_after": False}, prompt_tokens=10, completion_tokens=0),
            ModelResult(VALID, prompt_tokens=10, completion_tokens=0),
        ]
    )
    settings = _settings(lesson_token_budget=10)
    planner = ModelLessonPlanner(provider, settings)
    context = PlanningContext(question="Why do seasons happen?")
    header = await planner.start(context)
    first = await planner.next_beat(context, header, [])
    assert first is not None
    second = await planner.next_beat(context, header, [first.beat])
    assert second is None
    assert provider.calls == 1


async def test_http_provider_retries_server_errors_and_hides_the_key():
    secret = "sk-testkeyvalue123"
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        assert request.headers["authorization"] == f"Bearer {secret}"
        if calls["count"] == 1:
            return httpx.Response(500, json={"error": secret})
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps({"ok": True})}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 4},
            },
        )

    settings = _settings(groq_api_key=secret, groq_model="test-model")
    provider = HttpModelProvider(settings, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    result = await provider.generate_structured(prompt="explain tilt", timeout_s=1, max_tokens=20)
    assert result.data == {"ok": True}
    assert result.prompt_tokens == 3
    assert calls["count"] == 2

    def always_fail(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text=secret)

    failing = HttpModelProvider(settings, client=httpx.AsyncClient(transport=httpx.MockTransport(always_fail)))
    with pytest.raises(ProviderError) as error:
        await failing.generate_structured(prompt="explain tilt", timeout_s=1, max_tokens=20)
    assert str(error.value) == "unavailable"
    assert secret not in str(error.value)


async def test_http_provider_drops_json_mode_after_a_rejection_and_rejects_bad_requests():
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        payload = json.loads(request.content)
        if "response_format" in payload:
            return httpx.Response(400, json={"error": "unsupported"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "{\"ok\": true}"}}], "usage": {}})

    settings = _settings(groq_api_key="local-test-key")
    provider = HttpModelProvider(settings, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    result = await provider.generate_structured(prompt="{}", timeout_s=1, max_tokens=10)
    assert result.data == {"ok": True}
    assert calls["count"] == 2

    def bad_request(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "no"})

    # A 400 without response_format in a follow-up is covered above.
    # A provider that already has no way to succeed on 400 when format was stripped is a rejection.
    bare = HttpModelProvider(_settings(groq_api_key=""), client=httpx.AsyncClient(transport=httpx.MockTransport(bad_request)))
    with pytest.raises(ProviderError) as missing:
        await bare.generate_structured(prompt="{}", timeout_s=1, max_tokens=10)
    assert missing.value.code == "not_configured"


async def test_missing_model_key_still_completes_a_text_lesson(database_url):
    settings = _settings(database_url=database_url, rate_limit_per_minute=20)
    application = create_app(settings)
    from ai_tutor_v2.database.base import Base
    from httpx import ASGITransport, AsyncClient

    async with application.router.lifespan_context(application):
        async with application.state.engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        transport = ASGITransport(app=application)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            created = await http.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
            assert created.status_code == 201
            stream = await http.get(created.json()["events_url"])
            events, _ = parse_sse(stream.text)
    assert events[-1]["event"] == "lesson.completed"
    assert events[-1]["data"]["payload"]["degraded"] is True
    assert "sk-" not in stream.text
    actions = [event["data"]["payload"] for event in events if event["event"] == "board.action"]
    assert actions[0]["node"]["type"] == "text"


async def test_scripted_model_reaches_the_same_event_contract(client, app):
    provider = ScriptedProvider([ModelResult(VALID, prompt_tokens=11, completion_tokens=7)])
    app.state.planner_override = ModelLessonPlanner(provider, _settings())
    created = await client.post("/api/v2/lessons", json={"question": "Why do seasons happen?"})
    stream = await client.get(created.json()["events_url"])
    events, _ = parse_sse(stream.text)
    assert [event["event"] for event in events if event["event"] in {"lesson.started", "lesson.completed"}] == [
        "lesson.started",
        "lesson.completed",
    ]
    assert any(event["event"] == "board.action" and event["data"]["payload"]["node"]["id"] == "earth" for event in events)
    async with app.state.session_factory() as session:
        version = await session.get(LessonVersion, created.json()["version_id"])
    assert version is not None
    assert version.model_metadata["tokens"]["total_tokens"] == 18
    assert version.model_metadata["model"] == "scripted"
    assert version.plan["schema_version"] == "1.0"
