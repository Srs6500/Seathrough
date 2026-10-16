"""One model call per beat, one repair, then a text fallback."""

from __future__ import annotations

import json

from ai_tutor_v2.config import Settings
from ai_tutor_v2.providers.model import HttpModelProvider, ModelProvider, ModelResult, ProviderError
from ai_tutor_v2.services.board import BoardState
from ai_tutor_v2.services.fallback import text_fallback_beat
from ai_tutor_v2.services.normalize import clip_text
from ai_tutor_v2.services.planner import MODES, LessonPlanner, PlanHeader, PlannedBeat, PlanningContext
from ai_tutor_v2.services.prompts import beat_prompt
from ai_tutor_v2.services.validator import SceneValidationError, parse_beat


class ModelLessonPlanner:
    name = "model"

    def __init__(self, provider: ModelProvider, settings: Settings) -> None:
        self.provider = provider
        self.settings = settings
        self.model_name = getattr(provider, "model_name", "")
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self._stop = False

    @property
    def usage(self) -> dict:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.prompt_tokens + self.completion_tokens,
        }

    async def start(self, context: PlanningContext) -> PlanHeader:
        mode = context.requested_mode if context.requested_mode in MODES else None
        if mode is None:
            mode = "mixed" if context.include_example else "concept"
        return PlanHeader(title=clip_text(context.question, 80) or "Lesson", mode=mode)

    async def next_beat(self, context: PlanningContext, header: PlanHeader, previous: list) -> PlannedBeat | None:
        if self._stop or len(previous) >= self.settings.max_beats:
            return None
        if self.usage["total_tokens"] >= self.settings.lesson_token_budget:
            self._stop = True
            return None

        beat_number = len(previous) + 1
        history = [{"id": beat.id, "objective": beat.objective} for beat in previous]
        prompt = beat_prompt(context, header, beat_number=beat_number, previous=history)
        try:
            result = await self._generate(prompt)
        except ProviderError as error:
            if error.code == "malformed":
                return await self._repair(context, header, previous, beat_number, ["The response was not JSON."], "")
            self._stop = True
            return self._fallback(context.board, context.question, beat_number, error.code)

        try:
            beat = self._parse(result.data, context.board, beat_number)
        except SceneValidationError as error:
            return await self._repair(
                context,
                header,
                previous,
                beat_number,
                error.errors,
                json.dumps(result.data)[:1500],
            )
        if result.data.get("done_after") is True:
            self._stop = True
        return PlannedBeat(beat=beat)

    async def _repair(
        self,
        context: PlanningContext,
        header: PlanHeader,
        previous: list,
        beat_number: int,
        errors: list[str],
        previous_output: str,
    ) -> PlannedBeat:
        history = [{"id": beat.id, "objective": beat.objective} for beat in previous]
        prompt = beat_prompt(
            context,
            header,
            beat_number=beat_number,
            previous=history,
            repair_errors=errors,
            previous_output=previous_output,
        )
        try:
            result = await self._generate(prompt)
            beat = self._parse(result.data, context.board, beat_number)
            if result.data.get("done_after") is True:
                self._stop = True
            return PlannedBeat(beat=beat)
        except (ProviderError, SceneValidationError) as error:
            reason = error.code if isinstance(error, ProviderError) else "; ".join(error.errors)
            self._stop = True
            return self._fallback(context.board, context.question, beat_number, reason)

    async def _generate(self, prompt: str) -> ModelResult:
        result = await self.provider.generate_structured(
            prompt=prompt,
            timeout_s=self.settings.model_timeout_s,
            max_tokens=self.settings.model_max_tokens,
        )
        prompt_tokens = result.prompt_tokens or max(1, len(prompt) // 4)
        completion_tokens = result.completion_tokens
        self.prompt_tokens += prompt_tokens
        self.completion_tokens += completion_tokens
        return result

    def _parse(self, data: dict, board: BoardState, beat_number: int):
        payload = {
            "id": data.get("id") or f"b{beat_number}",
            "objective": data.get("objective") or "Explain the next idea",
            "narration": data.get("narration") or "",
            "board_actions": data.get("board_actions") or [],
            "evidence": data.get("evidence") or [],
        }
        return parse_beat(payload, board)

    def _fallback(self, board: BoardState, question: str, beat_number: int, reason: str) -> PlannedBeat:
        return PlannedBeat(
            beat=text_fallback_beat(
                board,
                narration=f"Let's explain {clip_text(question, 300)} in words.",
                objective="Explain the idea",
                beat_id=f"b{beat_number}",
            ),
            fallback_reason=reason,
        )


def build_planner(settings: Settings) -> LessonPlanner:
    if settings.planner_name == "model":
        return ModelLessonPlanner(provider=HttpModelProvider(settings), settings=settings)
    from ai_tutor_v2.services.planner import FakeLessonPlanner

    return FakeLessonPlanner()
