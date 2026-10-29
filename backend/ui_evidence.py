"""Named UI targets inferred from source. The model may only use these names."""

from __future__ import annotations

import re
from typing import Any

from auth_test_gen import infer_auth_evidence
from file_graph import route_for_path
from test_spec import targets_from_auth_evidence

TESTID = re.compile(r"data-testid\s*=\s*[\"']([^\"']+)[\"']", re.I)
SEARCH_INPUT = re.compile(
    r"<input\b[^>]*(?:type\s*=\s*[\"']search[\"']|name\s*=\s*[\"'](?:q|query|search)[\"'])",
    re.I,
)
FILE_INPUT = re.compile(r"<input\b[^>]*type\s*=\s*[\"']file[\"']", re.I)
TEXTAREA = re.compile(r"<textarea\b", re.I)
FORM = re.compile(r"<form\b|Form\b", re.I)
CREATE_BUTTON = re.compile(
    r"<button\b[^>]*>\s*([^<]*(?:create|add|new|save|submit)[^<]*)\s*</button>",
    re.I | re.S,
)
NAMED_INPUT = re.compile(
    r"<input\b[^>]*name\s*=\s*[\"'](email|password|username|query|q|search|title|amount|symbol|name)[\"']",
    re.I,
)


def _clean(path: Any) -> str:
    return str(path or "").replace("\\", "/").lstrip("./").strip()


def _blob(paths: list[str], sources: dict[str, str]) -> str:
    return "\n".join(sources.get(path) or "" for path in paths)


def _primary_route(feature: dict[str, Any]) -> str | None:
    for route in feature.get("entry_points") or []:
        text = str(route).strip()
        if text.startswith("/"):
            return text
    for path in feature.get("primary_files") or []:
        route = route_for_path(_clean(path))
        if route:
            return route
    return None


def generic_targets(source: str) -> dict[str, dict[str, str]]:
    targets: dict[str, dict[str, str]] = {}
    if FORM.search(source or ""):
        targets["form"] = {"kind": "css", "locator": "form"}
    if SEARCH_INPUT.search(source or ""):
        targets["search_input"] = {
            "kind": "css",
            "locator": 'input[type="search"], input[name="q"], input[name="query"]',
        }
    if FILE_INPUT.search(source or ""):
        targets["file_input"] = {"kind": "css", "locator": 'input[type="file"]'}
    if TEXTAREA.search(source or ""):
        targets["composer"] = {"kind": "css", "locator": "textarea"}
    create = CREATE_BUTTON.search(source or "")
    if create:
        label = re.sub(r"<[^>]+>", "", create.group(1)).strip() or "create|add|new"
        targets["create_button"] = {"kind": "role", "role": "button", "name": label}
    for match in NAMED_INPUT.finditer(source or ""):
        name = match.group(1).lower()
        key = {
            "q": "search_input",
            "query": "search_input",
            "search": "search_input",
            "email": "email_input",
            "password": "password_input",
            "username": "username_input",
        }.get(name, f"{name}_input")
        if key not in targets:
            if name == "password":
                locator = 'input[type="password"]'
            else:
                locator = f'input[name="{name}"]'
            targets[key] = {"kind": "css", "locator": locator}
    for testid in TESTID.findall(source or "")[:4]:
        slug = re.sub(r"[^a-z0-9]+", "_", testid.lower()).strip("_")[:32]
        if slug:
            targets[f"testid_{slug}"] = {"kind": "testid", "locator": testid}
    return targets


def infer_feature_evidence(
    feature: dict[str, Any],
    catalog: dict[str, Any] | None,
    sources: dict[str, str] | None,
    family: str,
) -> tuple[dict[str, Any], dict[str, dict[str, str]]]:
    source_map = {
        _clean(key): value for key, value in (sources or {}).items() if value
    }
    if family == "auth":
        evidence = infer_auth_evidence(feature, catalog, source_map)
        targets = targets_from_auth_evidence(evidence)
        extra = generic_targets(
            _blob([_clean(path) for path in feature.get("primary_files") or []], source_map)
        )
        for key, value in extra.items():
            targets.setdefault(key, value)
        return evidence, targets
    paths = [_clean(path) for path in feature.get("primary_files") or []]
    blob = _blob(paths, source_map)
    route = _primary_route(feature)
    routes = [str(item) for item in feature.get("entry_points") or [] if str(item).startswith("/")]
    evidence = {
        "primary_route": route,
        "routes": routes or ([route] if route else []),
        "login_route": None,
        "dashboard_route": route if route and "dashboard" in route.lower() else None,
        "session_api": None,
        "session_cookie": None,
        "storage_keys": [],
        "protected_apis": [],
        "source_files": paths[:4],
        "has_form": bool(FORM.search(blob)),
    }
    return evidence, generic_targets(blob)
