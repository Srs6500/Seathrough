"""
Misconception detection — text in, text out.

Figure out what the student is actually confused about.
Not wired to any frontend. Run from the repo root:

    python backend/Misconception.py "I think the derivative is how high the graph is"
    python backend/Misconception.py --file notes.txt
    python backend/Misconception.py --self-test
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

MAX_INPUT_CHARS = 4_000
REQUEST_TIMEOUT_SEC = 30

GROQ_MODEL_REPLACEMENTS = {
    "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
    "llama-3.1-8b-instant": "openai/gpt-oss-20b",
    "llama-3.1-70b-versatile": "openai/gpt-oss-120b",
    "meta-llama/llama-4-scout-17b-16e-instruct": "qwen/qwen3.8-27b",
    "qwen/qwen3.6-27b": "qwen/qwen3.8-27b",
}

SYSTEM_PROMPT = """You detect what a student is actually confused about.

A misconception is a stable wrong model — not a missing fact, not a calculation slip.
Your job is diagnosis, not teaching a full lesson.

Write plain text only. No JSON. No markdown tables. Use these labels, in this order:

Topic: <the concept, or "unclear">
Kind: misconception | knowledge gap | slip | actually correct | not a learning statement
What's confused: <one sentence naming the mix-up, or "none">
Wrong model: <what they seem to believe>
Right model: <the idea they need instead, 1-2 sentences, not a lecture>
Evidence: <short quote or paraphrase of their words>
Confidence: high | medium | low
Probe: <one question that would confirm this, or split two competing mix-ups>

Rules:
- If two mix-ups fit, name both under What's confused and make Probe split them.
- If they are right, Kind is actually correct. Do not invent a mix-up.
- If they simply don't know yet, Kind is knowledge gap.
- If the text is not about learning a concept, say so.
- No LaTeX. No secrets. No tutoring script after the probe.
"""


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


def require_python() -> None:
    if sys.version_info < (3, 10):
        raise RuntimeError(
            f"Python 3.10+ is required (found {sys.version.split()[0]})."
        )


def require_llm_keys() -> tuple[str, str, str]:
    """Load .env and verify the active LLM provider has a key."""
    require_python()
    load_env()
    return llm_config()


def describe_local_setup() -> str:
    """Human-readable readiness check for local runs (no secrets printed)."""
    require_python()
    load_env()
    lines = [
        f"Python {sys.version.split()[0]} OK",
        f"Repo root: {repo_root()}",
    ]
    provider = (env_value("LLM_PROVIDER") or "groq").lower()
    lines.append(f"LLM_PROVIDER={provider}")
    if provider == "openai":
        lines.append(
            "OPENAI_API_KEY=" + ("set" if env_value("OPENAI_API_KEY") else "MISSING")
        )
    else:
        lines.append(
            "GROQ_API_KEY=" + ("set" if env_value("GROQ_API_KEY") else "MISSING")
        )
        if env_value("GROQ_MODEL"):
            lines.append(f"GROQ_MODEL={resolve_groq_model(env_value('GROQ_MODEL'))}")
    lines.append(
        "TAVILY_API_KEY=" + ("set" if env_value("TAVILY_API_KEY") else "optional/unset")
    )
    try:
        key, model, _url = llm_config()
        lines.append(f"LLM ready (model={model}, key_len={len(key)})")
    except RuntimeError as error:
        lines.append(f"LLM not ready: {error}")
    return "\n".join(lines)


def resolve_groq_model(requested: str) -> str:
    model = requested or "openai/gpt-oss-20b"
    return GROQ_MODEL_REPLACEMENTS.get(model, model)


def llm_config() -> tuple[str, str, str]:
    provider = (env_value("LLM_PROVIDER") or "groq").lower()
    if provider == "openai":
        key = env_value("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("Missing OPENAI_API_KEY. Set it in .env, then retry.")
        model = env_value("OPENAI_MODEL") or "gpt-4.1"
        return key, model, "https://api.openai.com/v1/chat/completions"
    key = env_value("GROQ_API_KEY")
    if not key:
        raise RuntimeError("Missing GROQ_API_KEY. Set it in .env, then retry.")
    model = resolve_groq_model(env_value("GROQ_MODEL"))
    return key, model, "https://api.groq.com/openai/v1/chat/completions"


def validate_input(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("Input is empty. Paste what the student said.")
    if len(cleaned) > MAX_INPUT_CHARS:
        raise ValueError(
            f"Input is too long ({len(cleaned)} chars). Keep it under {MAX_INPUT_CHARS}."
        )
    return cleaned


def complete(
    system: str,
    user: str,
    *,
    max_tokens: int = 700,
    temperature: float = 0.2,
    timeout: int | None = None,
) -> str:
    text, _reason = complete_result(
        system,
        user,
        max_tokens=max_tokens,
        temperature=temperature,
        timeout=timeout,
    )
    return text


def complete_result(
    system: str,
    user: str,
    *,
    max_tokens: int = 700,
    temperature: float = 0.2,
    timeout: int | None = None,
) -> tuple[str, str]:
    api_key, model, url = llm_config()
    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
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
        with urllib.request.urlopen(request, timeout=timeout or REQUEST_TIMEOUT_SEC) as response:
            body = json.loads(response.read().decode("utf-8"))
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
        raise RuntimeError("The model timed out. Try again with a shorter statement.") from error

    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("The model returned no choices.")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part) for part in content
        )
    text = (content or "").strip()
    if not text:
        raise RuntimeError("The model returned empty text.")
    reason = str(choices[0].get("finish_reason") or "").strip().lower()
    return text, reason


def detect(text: str, topic: str | None = None, context: str | None = None) -> str:
    """Detect the misconception in `text`. Returns plain text."""
    student = validate_input(text)
    parts: list[str] = []
    if (topic or "").strip():
        parts.append(f"Topic hint: {topic.strip()}")
    if (context or "").strip():
        parts.append(context.strip())
    user = ("\n\n".join(parts) + f"\n\nStudent said:\n{student}") if parts else student
    return complete(SYSTEM_PROMPT, user)


def self_test() -> str:
    cases: list[tuple[str, str]] = [
        ("", "empty"),
        ("   \n\t  ", "whitespace"),
        ("x" * (MAX_INPUT_CHARS + 1), "too long"),
    ]
    lines = ["Self-test (local validation, no model call):"]
    for sample, label in cases:
        try:
            validate_input(sample)
            lines.append(f"- {label}: FAIL (should have rejected)")
        except ValueError as error:
            lines.append(f"- {label}: ok ({error})")

    try:
        llm_config()
        lines.append("- llm config: ok (key present, value not printed)")
    except RuntimeError as error:
        lines.append(f"- llm config: {error}")
    return "\n".join(lines)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detect what a student is actually confused about.",
    )
    parser.add_argument("text", nargs="*", help="Student statement")
    parser.add_argument("--file", "-f", help="Read student text from a file")
    parser.add_argument("--topic", "-t", help="Optional topic hint")
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run empty / too-long / missing-key checks without teaching",
    )
    return parser.parse_args(argv)


def read_student_text(args: argparse.Namespace) -> str:
    if args.file:
        path = Path(args.file)
        if not path.is_file():
            raise ValueError(f"File not found: {path}")
        return path.read_text(encoding="utf-8")
    if args.text:
        return " ".join(args.text)
    if not sys.stdin.isatty():
        return sys.stdin.read()
    raise ValueError("No input. Pass text, --file, or pipe stdin.")


def main(argv: list[str] | None = None) -> int:
    load_env()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        if args.self_test:
            print(self_test())
            return 0
        print(detect(read_student_text(args), topic=args.topic))
        return 0
    except (ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
