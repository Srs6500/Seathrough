"""In-process request limits for a single API instance."""

from __future__ import annotations

import time


class RateLimiter:
    def __init__(self, limit: int, window_s: float = 60) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, list[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        recent = [stamp for stamp in self._hits.get(key, []) if now - stamp < self.window_s]
        if len(recent) >= self.limit:
            self._hits[key] = recent
            return False
        recent.append(now)
        self._hits[key] = recent
        return True
