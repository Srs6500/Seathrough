"""Single-process signals. PostgreSQL remains the event source of truth."""

from __future__ import annotations

import asyncio


class EventBus:
    def __init__(self) -> None:
        self._conditions: dict[str, asyncio.Condition] = {}

    def _condition(self, lesson_id: str) -> asyncio.Condition:
        condition = self._conditions.get(lesson_id)
        if condition is None:
            condition = asyncio.Condition()
            self._conditions[lesson_id] = condition
        return condition

    async def publish(self, lesson_id: str) -> None:
        condition = self._condition(lesson_id)
        async with condition:
            condition.notify_all()

    async def wait(self, lesson_id: str, timeout: float) -> bool:
        condition = self._condition(lesson_id)
        try:
            async with condition:
                await asyncio.wait_for(condition.wait(), timeout)
            return True
        except TimeoutError:
            return False


class GenerationRegistry:
    def __init__(self) -> None:
        self.cancel_events: dict[str, asyncio.Event] = {}
        self.tasks: dict[str, asyncio.Task] = {}

    def cancel_event(self, version_id: str) -> asyncio.Event:
        event = self.cancel_events.get(version_id)
        if event is None:
            event = asyncio.Event()
            self.cancel_events[version_id] = event
        return event

    def track(self, version_id: str, task: asyncio.Task) -> None:
        self.tasks[version_id] = task

    def cancel(self, version_id: str) -> None:
        self.cancel_event(version_id).set()
