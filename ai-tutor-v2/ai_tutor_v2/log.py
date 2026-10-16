"""Structured logs for AI Tutor v2. Lesson text and secrets are omitted."""

from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger("seethrough.ai_tutor_v2")

_SECRET = re.compile(
    r"(sk-[A-Za-z0-9_\-]{8,}|gsk_[A-Za-z0-9_\-]{8,}|Bearer\s+[A-Za-z0-9._\-]{8,})",
    re.I,
)


def redact(value: object) -> str:
    return _SECRET.sub("[redacted]", str(value))


def log_event(level: int, message: str, **fields: object) -> None:
    safe = {key: redact(value) for key, value in fields.items()}
    logger.log(level, "%s %s", message, json.dumps(safe, default=str, sort_keys=True))
