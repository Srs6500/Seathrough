"""Chat-completions client for backend Python tools (Groq / OpenAI)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REQUEST_TIMEOUT_SEC = 20

GROQ_MODEL_REPLACEMENTS = {
    "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
    "llama-3.1-8b-instant": "openai/gpt-oss-20b",
    "llama-3.1-70b-versatile": "openai/gpt-oss-120b",
    "meta-llama/llama-4-scout-17b-16e-instruct": "qwen/qwen3.6-27b",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def load_env() -> None:
    root = repo_root()
    load_env_file(root / ".env")
    load_env_file(root / ".env.local")


def env_value(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def resolve_groq_model(requested: str) -> str:
    model = requested or "openai/gpt-oss-20b"
    return GROQ_MODEL_REPLACEMENTS.get(model, model)


def llm_config() -> tuple[str, str, str]:
    provider = (env_value("LLM_PROVIDER") or "groq").lower()
    if provider == "openai":
        key = env_value("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("Missing OPENAI_API_KEY.")
        model = env_value("OPENAI_MODEL") or "gpt-4.1"
        return key, model, "https://api.openai.com/v1/chat/completions"
    key = env_value("GROQ_API_KEY")
    if not key:
        raise RuntimeError("Missing GROQ_API_KEY.")
    model = resolve_groq_model(env_value("GROQ_MODEL"))
    return key, model, "https://api.groq.com/openai/v1/chat/completions"


def has_llm_config() -> bool:
    load_env()
    try:
        llm_config()
        return True
    except RuntimeError:
        return False


def _request(payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    api_key, _model, url = llm_config()
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "SeethroughBackend/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        snippet = raw.strip().replace("\n", " ")[:180]
        if "<html" in raw.lower() or "error code: 1010" in raw:
            raise RuntimeError(
                f"Model request failed ({error.code}). The provider blocked this client."
            ) from error
        raise RuntimeError(f"Model request failed ({error.code}). {snippet}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Network/API failure talking to the model: {error.reason}") from error
    except TimeoutError as error:
        raise RuntimeError("The model timed out.") from error


def _content_from_body(body: dict[str, Any]) -> str:
    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("The model returned no choices.")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    text = (content or "").strip()
    if not text:
        raise RuntimeError("The model returned empty text.")
    return text


class LlmClient:
    """Existing chat adapter: prompt in, text out. Optional JSON mode."""

    def __init__(self, timeout: int = REQUEST_TIMEOUT_SEC) -> None:
        load_env()
        self.timeout = timeout

    def generate(
        self,
        prompt: str,
        response_format: str | None = None,
        max_tokens: int = 500,
    ) -> str:
        if not (prompt or "").strip():
            raise ValueError("Prompt is empty.")
        _key, model, _url = llm_config()
        payload: dict[str, Any] = {
            "model": model,
            "temperature": 0.1,
            "max_tokens": max(64, min(int(max_tokens), 2000)),
            "messages": [{"role": "user", "content": prompt}],
        }
        if response_format == "json":
            payload["response_format"] = {"type": "json_object"}
        try:
            body = _request(payload, self.timeout)
        except RuntimeError as error:
            if response_format == "json" and "response_format" in str(error):
                payload.pop("response_format", None)
                body = _request(payload, self.timeout)
            else:
                raise
        return _content_from_body(body)
