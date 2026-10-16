import pytest
from pydantic import ValidationError

from ai_tutor_v2.schemas.scene import LessonBeat, LessonPlan, TextNode
from ai_tutor_v2.services.board import BoardState
from ai_tutor_v2.services.fallback import text_fallback_beat
from ai_tutor_v2.services.planner import FakeLessonPlanner, InteractionHint, PlanningContext, plan_from_beats
from ai_tutor_v2.services.validator import SceneValidationError, parse_beat


def _beat(**overrides):
    data = {
        "id": "b1",
        "objective": "Introduce the idea",
        "narration": "A hash map stores values by key.",
        "board_actions": [
            {
                "type": "create",
                "animation": "draw",
                "node": {"id": "title", "type": "text", "x": 40, "y": 40, "text": "Hash map", "role": "title"},
            }
        ],
    }
    data.update(overrides)
    return data


def test_valid_beat_and_plan_round_trip():
    beat = parse_beat(_beat(), BoardState())
    plan = LessonPlan(title="Hash maps", mode="concept", beats=[beat])
    again = LessonPlan.model_validate(plan.model_dump())
    assert again.schema_version == "1.0"
    assert again.beats[0].board_actions[0].node.type == "text"


def test_schema_rejects_malformed_and_oversized_output():
    with pytest.raises(ValidationError):
        LessonBeat.model_validate(_beat(narration=""))
    with pytest.raises(ValidationError):
        LessonBeat.model_validate(_beat(narration="x" * 2001))
    with pytest.raises(ValidationError):
        TextNode(id="title", x=10, y=10, text="ok", html="<b>no</b>")
    script = parse_beat(
        _beat(board_actions=[{"type": "create", "node": {"id": "n", "type": "script", "code": "alert(1)"}}]),
        BoardState(),
    )
    assert script.board_actions == []
    assert "alert" not in script.model_dump_json()
    with pytest.raises(ValidationError):
        TextNode(id="1bad", x=0, y=0, text="no")
    with pytest.raises(ValidationError):
        TextNode(id="title", x=float("inf"), y=0, text="no")
    with pytest.raises(ValidationError):
        TextNode(id="title", x=True, y=0, text="no")
    with pytest.raises(ValidationError):
        LessonPlan(title="Too many", beats=[LessonBeat.model_validate(_beat(id=f"b{i}")) for i in range(21)])


def test_model_aliases_and_style_fields_become_a_valid_beat():
    beat = parse_beat(
        {
            "objective": "Show the tilt",
            "narration": "Earth is tilted.",
            "done_after": True,
            "boardActions": [
                {
                    "type": "create",
                    "node": {
                        "id": "tilt",
                        "type": "arrow",
                        "from": {"x": 10, "y": 20},
                        "to": {"x": 30, "y": 40},
                        "color": "red",
                        "label": "tilt",
                    },
                },
                {"type": "point", "targetId": "tilt", "emphasisMs": 100, "style": "glow"},
            ],
        },
        BoardState(),
    )
    assert beat.board_actions[0].node.start.x == 10
    assert beat.board_actions[0].node.end.x == 30
    assert beat.board_actions[1].target_id == "tilt"
    assert beat.board_actions[1].emphasis_ms == 100

    partial = parse_beat(
        _beat(
            board_actions=[
                {
                    "type": "create",
                    "node": {"id": "sun", "type": "box", "x": 40, "y": 40, "width": 80, "height": 40, "label": "Sun"},
                },
                {"type": "create", "node": {"id": "note", "type": "text", "x": 40, "y": 100}},
            ]
        ),
        BoardState(),
    )
    assert [action.node.id for action in partial.board_actions] == ["sun"]


def test_normalizer_clamps_a_box_that_runs_past_the_board():
    beat = parse_beat(
        _beat(
            board_actions=[
                {
                    "type": "create",
                    "node": {
                        "id": "sun",
                        "type": "box",
                        "x": 1200,
                        "y": -40,
                        "width": 400,
                        "height": 80,
                        "label": "Sun",
                    },
                }
            ]
        ),
        BoardState(),
    )
    box = beat.board_actions[0].node
    assert box.x == 999
    assert box.y == 0
    assert box.x + box.width <= 1000
    assert box.y + box.height <= 1000


def test_normalizer_truncates_long_text_instead_of_failing_the_beat():
    beat = parse_beat(_beat(narration="word " * 1000), BoardState())
    assert len(beat.narration) <= 2000
    assert beat.narration.endswith("…")


def test_semantic_validator_rejects_broken_references():
    board = BoardState()
    first = parse_beat(_beat(), board)
    board.apply_beat(first)

    with pytest.raises(SceneValidationError) as duplicate:
        parse_beat(_beat(), board)
    assert any("reuses id" in item for item in duplicate.value.errors)

    with pytest.raises(SceneValidationError) as missing:
        parse_beat(
            _beat(board_actions=[{"type": "point", "target_id": "missing"}]),
            board,
        )
    assert any("missing id" in item for item in missing.value.errors)

    trimmed = parse_beat(
        _beat(
            id="b2",
            board_actions=[
                {"type": "remove", "target_id": "title"},
                {"type": "point", "target_id": "title"},
            ],
        ),
        board,
    )
    assert [action.type for action in trimmed.board_actions] == ["remove"]

    gone = parse_beat(_beat(id="b2", board_actions=[{"type": "remove", "target_id": "title"}]), board)
    replay = board.copy()
    replay.apply_beat(gone)
    assert "title" not in replay.nodes


def test_update_must_match_the_node_and_change_something():
    board = BoardState()
    board.apply_beat(parse_beat(_beat(), board))
    with pytest.raises(SceneValidationError) as mismatch:
        parse_beat(
            _beat(
                id="b2",
                board_actions=[{"type": "update", "target_id": "title", "patch": {"width": 20, "height": 20}}],
            ),
            board,
        )
    assert any("cannot change" in item for item in mismatch.value.errors)

    with pytest.raises(SceneValidationError) as empty:
        parse_beat(
            _beat(id="b2", board_actions=[{"type": "update", "target_id": "title", "patch": {}}]),
            board,
        )
    assert any("empty" in item for item in empty.value.errors)


def test_replay_is_stable():
    board = BoardState()
    beat = parse_beat(_beat(), board)
    board.apply_beat(beat)
    again = BoardState()
    again.apply_beat(LessonBeat.model_validate(beat.model_dump()))
    assert board.snapshot() == again.snapshot()


def test_fallback_is_valid_on_a_board_that_already_has_notes():
    board = BoardState({"note_1": {"id": "note_1", "type": "text"}})
    beat = text_fallback_beat(board, narration="", objective="", beat_id="!!!")
    parsed = parse_beat(beat.model_dump(), board)
    assert parsed.id == "fallback"
    assert parsed.board_actions[0].node.id == "note_2"
    assert parsed.narration


async def test_fake_planner_matches_the_lesson_contract():
    planner = FakeLessonPlanner()
    context = PlanningContext(
        question="Why do seasons happen?",
        learner_level="beginner",
        include_example=True,
        evidence=[{"source_id": "calc", "claim": "A year is about 365 days."}],
    )
    header = await planner.start(context)
    beats = []
    while True:
        beat = await planner.next_beat(context, header, beats)
        if beat is None:
            break
        parse_beat(beat.model_dump(), context.board)
        context.board.apply_beat(beat)
        beats.append(beat)
    plan = plan_from_beats(header, beats)
    assert plan.mode == "mixed"
    assert [beat.id for beat in plan.beats] == ["b1", "b2", "b3"]
    assert plan.beats[0].evidence[0].claim.startswith("A year")
    assert {node["id"] for node in context.board.snapshot()} == {"title", "topic", "idea", "link", "example"}


async def test_fake_follow_up_points_at_an_existing_node():
    planner = FakeLessonPlanner()
    board = BoardState()
    intro = PlanningContext(question="Why do seasons happen?")
    header = await planner.start(intro)
    first = await planner.next_beat(intro, header, [])
    assert first is not None
    board.apply_beat(first)
    follow = PlanningContext(
        question="Why do seasons happen?",
        interaction=InteractionHint(
            kind="question",
            text="Does Earth being closer to the Sun cause summer?",
        ),
        board=board,
    )
    header = await planner.start(follow)
    beat = await planner.next_beat(follow, header, [])
    assert beat is not None
    parse_beat(beat.model_dump(), board)
    kinds = [action.type for action in beat.board_actions]
    assert kinds == ["point", "create"]
    assert beat.board_actions[0].target_id == "title"


async def test_empty_question_still_has_a_title():
    planner = FakeLessonPlanner()
    header = await planner.start(PlanningContext(question="   "))
    assert header.title == "Lesson"
