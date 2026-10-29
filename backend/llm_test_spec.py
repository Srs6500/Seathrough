"""Ask the model for restricted specs only. Drop anything the schema rejects."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from test_spec import ACTION_TYPES, ASSERTION_TYPES, validate_spec

MAX_SPECS = 3
MAX_FEATURES = 8
CACHE_VERSION = 1


def _env_flag(name: str) -> str:
    return (os.environ.get(name) or "").strip().lower()


def llm_specs_enabled() -> bool:
    flag = _env_flag("REPO_SCAN_TEST_PLANNER_LLM")
    if flag in {"0", "false", "no"}:
        return False
    if flag in {"1", "true", "yes"}:
        return True
    if not (
        (os.environ.get("REPO_SCAN_SANDBOX") or "").strip().lower()
        in {"1", "true", "yes"}
        and (os.environ.get("REPO_SCAN_TEST_BASE_URL") or "").strip()
    ):
        return False
    try:
        from llm_client import has_llm_config

        return has_llm_config()
    except Exception:
        return False


def _cache_path() -> Path:
    override = (os.environ.get("REPO_SCAN_TEST_SPEC_CACHE") or "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / ".seethrough" / "test-spec-cache.json"


def _fingerprint(feature: dict[str, Any], targets: dict[str, Any]) -> str:
    payload = {
        "id": feature.get("feature_id"),
        "routes": feature.get("entry_points") or [],
        "files": feature.get("primary_files") or [],
        "targets": sorted(targets),
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(f"{CACHE_VERSION}:{encoded.decode()}".encode()).hexdigest()


def _load_cache() -> dict[str, Any]:
    path = _cache_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _store_cache(cache: dict[str, Any]) -> None:
    path = _cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(cache), encoding="utf-8")
    except OSError:
        return


def _prompt(
    feature: dict[str, Any],
    targets: dict[str, dict[str, str]],
    evidence: dict[str, Any],
) -> str:
    routes = [
        str(item)
        for item in (feature.get("entry_points") or evidence.get("routes") or [])
        if str(item).startswith("/")
    ]
    resources = [str(item) for item in evidence.get("protected_apis") or []]
    return (
        "Propose restricted tests for this software feature. Return JSON "
        '{"tests":[{"name":"string","actions":[],"assertions":[]}]}. '
        f"Allowed action types: {', '.join(ACTION_TYPES)}. "
        f"Allowed assertion types: {', '.join(ASSERTION_TYPES)}. "
        "Use only these target names: "
        f"{', '.join(sorted(targets)) or '(none)'}. "
        f"Navigate only to: {', '.join(routes) or '(none)'}. "
        f"Protected resources: {', '.join(resources) or '(none)'}. "
        "Fill values may only be invalid@example.test, invalid-user, "
        "or incorrect-password. Do not invent selectors, routes, cookies, "
        "or credentials. Skip tests you cannot express with this vocabulary. "
        "Max 3 tests.\n"
        f"name={feature.get('name')}\n"
        f"files={feature.get('primary_files')}\n"
    )


def propose_restricted_specs(
    feature: dict[str, Any],
    *,
    targets: dict[str, dict[str, str]],
    evidence: dict[str, Any],
    family: str,
) -> list[dict[str, Any]]:
    if family == "auth":
        return []
    if not targets and not (feature.get("entry_points") or evidence.get("routes")):
        return []
    if not llm_specs_enabled():
        return []
    fingerprint = _fingerprint(feature, targets)
    cache = _load_cache()
    cached = cache.get(fingerprint)
    if isinstance(cached, list):
        return [item for item in cached if isinstance(item, dict)][:MAX_SPECS]
    try:
        from llm_client import LlmClient, has_llm_config
    except Exception:
        return []
    if not has_llm_config():
        return []
    try:
        raw = LlmClient(timeout=12).generate(
            _prompt(feature, targets, evidence),
            response_format="json",
            max_tokens=900,
        )
        data = json.loads(raw)
    except Exception:
        return []
    tests = data.get("tests") if isinstance(data, dict) else None
    if not isinstance(tests, list):
        return []
    approved: list[dict[str, Any]] = []
    for item in tests:
        if not isinstance(item, dict):
            continue
        item = dict(item)
        item["origin"] = "llm"
        item["feature"] = str(feature.get("feature_id") or "")
        valid = validate_spec(
            item,
            targets=targets,
            feature=feature,
            evidence=evidence,
            origin="llm",
        )
        if valid:
            approved.append(valid)
        if len(approved) >= MAX_SPECS:
            break
    cache[fingerprint] = approved
    _store_cache(cache)
    return approved


def self_test() -> int:
    os.environ["REPO_SCAN_TEST_PLANNER_LLM"] = "0"
    os.environ.pop("REPO_SCAN_SANDBOX", None)
    empty = propose_restricted_specs(
        {"feature_id": "grid", "entry_points": ["/grid"], "primary_files": []},
        targets={"form": {"kind": "css", "locator": "form"}},
        evidence={"routes": ["/grid"]},
        family="unknown",
    )
    if empty != []:
        print("LLM specs must stay off when disabled", file=sys.stderr)
        return 2
    from test_spec import validate_spec

    feature = {"feature_id": "grid", "entry_points": ["/grid"]}
    targets = {"form": {"kind": "css", "locator": "form"}}
    evidence = {"routes": ["/grid"], "primary_route": "/grid"}
    invented = validate_spec(
        {
            "name": "Run shell",
            "actions": [{"type": "navigate", "path": "/grid"}],
            "assertions": [{"type": "visible", "target": "document.querySelector"}],
        },
        targets=targets,
        feature=feature,
        evidence=evidence,
        origin="llm",
    )
    if invented is not None:
        print("LLM invented targets must be dropped", file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, "selfTest": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
