"""Model calls stay behind this adapter. Prompts and vendor payloads do not enter Scene IR."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Protocol

import httpx

from ai_tutor_v2.config import Settings

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I)


class ProviderError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class ModelResult:
    data: dict
    prompt_tokens: int
    completion_tokens: int


class ModelProvider(Protocol):
    model_name: str

    async def generate_structured(self, *, prompt: str, timeout_s: float, max_tokens: int) -> ModelResult: ...


def parse_json_object(text: str) -> dict:
    cleaned = _FENCE.sub("", (text or "").strip())
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise ProviderError("malformed") from error
    if not isinstance(data, dict):
        raise ProviderError("malformed")
    return data


class HttpModelProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self._client = client
        self._api_key, self.model_name, self._url = _credentials(settings)

    async def generate_structured(self, *, prompt: str, timeout_s: float, max_tokens: int) -> ModelResult:
        if not self._api_key:
            raise ProviderError("not_configured")
        payload = {
            "model": self.model_name,
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You write one whiteboard lesson beat as JSON. "
                        "Use only text, box, and arrow nodes. Do not return HTML, JavaScript, or executable code."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        }
        last_error = ProviderError("transport")
        for attempt in range(2):
            try:
                response = await self._post(payload, timeout_s)
            except httpx.TimeoutException as error:
                last_error = ProviderError("timeout")
                if attempt == 0:
                    continue
                raise last_error from error
            except httpx.HTTPError as error:
                last_error = ProviderError("transport")
                if attempt == 0:
                    continue
                raise last_error from error

            if response.status_code == 400 and "response_format" in payload:
                payload = {key: value for key, value in payload.items() if key != "response_format"}
                continue
            if response.status_code in {429, 500, 502, 503} and attempt == 0:
                last_error = ProviderError("unavailable")
                continue
            if response.status_code >= 400:
                raise ProviderError("rejected" if response.status_code < 500 else "unavailable")
            try:
                body = response.json()
                content = body["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError, ValueError) as error:
                raise ProviderError("malformed") from error
            usage = body.get("usage") or {}
            return ModelResult(
                data=parse_json_object(content),
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
            )
        raise last_error

    async def _post(self, payload: dict, timeout_s: float) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        if self._client is not None:
            return await self._client.post(self._url, json=payload, headers=headers, timeout=timeout_s)
        async with httpx.AsyncClient() as client:
            return await client.post(self._url, json=payload, headers=headers, timeout=timeout_s)


def _credentials(settings: Settings) -> tuple[str, str, str]:
    provider = (settings.llm_provider or "groq").strip().lower()
    if provider == "openai":
        return settings.openai_api_key, settings.openai_model, "https://api.openai.com/v1/chat/completions"
    return settings.groq_api_key, settings.groq_model or "openai/gpt-oss-20b", "https://api.groq.com/openai/v1/chat/completions"
