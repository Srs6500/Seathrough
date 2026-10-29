"""Restricted test specifications. The model never emits Playwright.

Approved actions and assertions are the only instructions the runner
will compile. Selectors, routes, and session endpoints come from
repository analysis, not from free-form model text.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any

ACTION_TYPES = ("navigate", "fill", "click", "press", "wait_load")
ASSERTION_TYPES = (
    "visible",
    "hidden",
    "url_not_match",
    "url_match",
    "page_loaded",
    "session_absent",
    "session_present",
    "protected_resource_denied",
    "text_contains",
)
PRESS_KEYS = {"Enter", "Tab", "Escape"}
TARGET_NAME = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
PATH_SAFE = re.compile(r"^/[A-Za-z0-9._/~:@!$&'()*+,;=%\-]*$")
FILL_VALUES = {
    "invalid_email": "invalid@example.test",
    "invalid_user": "invalid-user",
    "invalid_password": "incorrect-password",
    "empty": "",
    "invalid@example.test": "invalid@example.test",
    "invalid-user": "invalid-user",
    "incorrect-password": "incorrect-password",
    "invalid-password": "incorrect-password",
}
MAX_TEXT = 80


def _clean_path(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text.startswith("/") or "://" in text or ".." in text:
        return None
    if not PATH_SAFE.fullmatch(text.split("?")[0]):
        return None
    if len(text) > 180:
        return None
    return text


def _target_name(value: Any) -> str | None:
    text = str(value or "").strip()
    if TARGET_NAME.fullmatch(text):
        return text
    return None


def _fill_value(value: Any) -> str | None:
    raw = str(value or "")
    if raw in FILL_VALUES:
        return FILL_VALUES[raw]
    if raw.startswith("env:"):
        import os

        key = raw[4:].strip()
        if key in {
            "TEST_USER",
            "TEST_PASSWORD",
            "REPO_SCAN_TEST_USER",
            "REPO_SCAN_TEST_PASSWORD",
        }:
            env_name = (
                "REPO_SCAN_TEST_PASSWORD"
                if key in {"TEST_PASSWORD", "REPO_SCAN_TEST_PASSWORD"}
                else "REPO_SCAN_TEST_USER"
            )
            found = (os.environ.get(env_name) or "").strip()
            return found or None
        return None
    return None


def targets_from_auth_evidence(evidence: dict[str, Any]) -> dict[str, dict[str, str]]:
    targets: dict[str, dict[str, str]] = {}
    identity = evidence.get("identity") if isinstance(evidence.get("identity"), dict) else None
    if identity and identity.get("locator"):
        kind = str(identity.get("kind") or "email")
        name = "email_input" if kind == "email" else "username_input"
        targets[name] = {"kind": "css", "locator": str(identity["locator"])}
        if kind == "email":
            targets["email_input"] = targets[name]
    if evidence.get("has_password"):
        targets["password_input"] = {
            "kind": "css",
            "locator": 'input[type="password"]',
        }
    submit = str(evidence.get("submit_name") or "log in|sign in")
    targets["submit_button"] = {"kind": "role", "role": "button", "name": submit}
    if evidence.get("has_form"):
        targets["form"] = {"kind": "css", "locator": "form"}
    markers = evidence.get("private_markers") or []
    if markers and isinstance(markers[0], dict) and markers[0].get("testid"):
        targets["private_marker"] = {
            "kind": "testid",
            "locator": str(markers[0]["testid"]),
        }
    return targets


def allowed_paths_for(feature: dict[str, Any], evidence: dict[str, Any]) -> set[str]:
    paths: set[str] = set()
    for route in list(feature.get("entry_points") or []) + [
        evidence.get("login_route"),
        evidence.get("dashboard_route"),
        evidence.get("primary_route"),
    ]:
        cleaned = _clean_path(route)
        if cleaned:
            paths.add(cleaned)
    for extra in evidence.get("routes") or []:
        cleaned = _clean_path(extra)
        if cleaned:
            paths.add(cleaned)
    return paths


def allowed_resources_for(evidence: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    for item in evidence.get("protected_apis") or []:
        cleaned = _clean_path(item)
        if cleaned:
            found.add(cleaned)
    session = _clean_path(evidence.get("session_api"))
    if session:
        found.add(session)
    return found


def validate_action(
    action: dict[str, Any],
    *,
    targets: dict[str, dict[str, str]],
    paths: set[str],
) -> dict[str, Any] | None:
    if not isinstance(action, dict):
        return None
    kind = str(action.get("type") or "").strip()
    if kind not in ACTION_TYPES:
        return None
    if kind == "navigate":
        path = _clean_path(action.get("path"))
        if not path or path not in paths:
            return None
        return {"type": "navigate", "path": path}
    if kind == "fill":
        target = _target_name(action.get("target"))
        raw = str(action.get("value") or "")
        if raw.startswith("env:"):
            key = raw[4:].strip()
            if (
                key
                not in {
                    "TEST_USER",
                    "TEST_PASSWORD",
                    "REPO_SCAN_TEST_USER",
                    "REPO_SCAN_TEST_PASSWORD",
                }
                or not target
                or target not in targets
                or _fill_value(raw) is None
            ):
                return None
            return {"type": "fill", "target": target, "value": f"env:{key}"}
        value = _fill_value(raw)
        if not target or target not in targets or value is None:
            return None
        return {"type": "fill", "target": target, "value": value}
    if kind == "click":
        target = _target_name(action.get("target"))
        if not target or target not in targets:
            return None
        return {"type": "click", "target": target}
    if kind == "press":
        target = _target_name(action.get("target"))
        key = str(action.get("key") or "")
        if not target or target not in targets or key not in PRESS_KEYS:
            return None
        return {"type": "press", "target": target, "key": key}
    timeout = action.get("timeout_ms")
    wait: dict[str, Any] = {"type": "wait_load"}
    if isinstance(timeout, int) and 100 <= timeout <= 8000:
        wait["timeout_ms"] = timeout
    return wait


def validate_assertion(
    assertion: dict[str, Any],
    *,
    targets: dict[str, dict[str, str]],
    paths: set[str],
    resources: set[str],
) -> dict[str, Any] | None:
    if not isinstance(assertion, dict):
        return None
    kind = str(assertion.get("type") or "").strip()
    if kind not in ASSERTION_TYPES:
        return None
    if kind in {"visible", "hidden"}:
        target = _target_name(assertion.get("target"))
        if not target or target not in targets:
            return None
        return {"type": kind, "target": target}
    if kind in {"url_not_match", "url_match"}:
        path = _clean_path(assertion.get("path"))
        if not path or path not in paths:
            return None
        return {"type": kind, "path": path}
    if kind == "protected_resource_denied":
        resource = _clean_path(assertion.get("resource"))
        if not resource or resource not in resources:
            return None
        return {"type": kind, "resource": resource}
    if kind == "text_contains":
        text = str(assertion.get("text") or "").strip()
        if not text or len(text) > MAX_TEXT or "<" in text or "\n" in text:
            return None
        return {"type": kind, "text": text}
    return {"type": kind}


def validate_spec(
    spec: dict[str, Any],
    *,
    targets: dict[str, dict[str, str]],
    feature: dict[str, Any],
    evidence: dict[str, Any],
    origin: str,
) -> dict[str, Any] | None:
    if not isinstance(spec, dict):
        return None
    name = str(spec.get("name") or "").strip()
    if not name or len(name) > 120:
        return None
    paths = allowed_paths_for(feature, evidence)
    resources = allowed_resources_for(evidence)
    actions = []
    for item in spec.get("actions") or []:
        valid = validate_action(item, targets=targets, paths=paths)
        if not valid:
            return None
        actions.append(valid)
    assertions = []
    for item in spec.get("assertions") or []:
        valid = validate_assertion(
            item, targets=targets, paths=paths, resources=resources
        )
        if not valid:
            return None
        assertions.append(valid)
    if not assertions:
        return None
    needs_session = any(
        item["type"] in {"session_absent", "session_present"} for item in assertions
    )
    if needs_session and not (
        evidence.get("session_api")
        or evidence.get("session_cookie")
        or evidence.get("storage_keys")
    ):
        return None
    spec_id = str(spec.get("id") or "").strip() or None
    return {
        "id": spec_id,
        "name": name,
        "feature": str(spec.get("feature") or feature.get("feature_id") or ""),
        "origin": origin if origin in {"template", "llm"} else "template",
        "actions": actions,
        "assertions": assertions,
        "assertion": _assertion_label(assertions, name),
    }


def _assertion_label(assertions: list[dict[str, Any]], name: str = "") -> str:
    first = assertions[0] if assertions else {}
    kind = str(first.get("type") or "")
    lowered = name.lower()
    if "login page renders" in lowered:
        return "Inferred login controls are visible"
    if "anonymous visit" in lowered:
        if kind == "hidden":
            return "private_testid_hidden"
        return "anonymous_dashboard_redirect"
    mapping = {
        "url_not_match": "did_not_navigate_to_dashboard",
        "session_absent": "no_authenticated_session",
        "session_present": "authenticated_session",
        "protected_resource_denied": "anonymous_api_unauthorized",
        "hidden": "private_testid_hidden",
        "url_match": "url_match",
        "page_loaded": "page_loaded",
        "visible": "control_visible",
        "text_contains": "text_contains",
    }
    return mapping.get(kind, kind)


def self_test() -> int:
    targets = {
        "email_input": {"kind": "css", "locator": 'input[type="email"]'},
        "password_input": {"kind": "css", "locator": 'input[type="password"]'},
        "submit_button": {"kind": "role", "role": "button", "name": "Sign in"},
    }
    feature = {"feature_id": "authentication", "entry_points": ["/login", "/dashboard"]}
    evidence = {
        "login_route": "/login",
        "dashboard_route": "/dashboard",
        "session_api": "/api/auth/session",
        "protected_apis": ["/api/me"],
        "storage_keys": ["access_token"],
    }
    good = validate_spec(
        {
            "name": "Invalid login stays off the dashboard",
            "actions": [
                {"type": "navigate", "path": "/login"},
                {"type": "fill", "target": "email_input", "value": "invalid@example.test"},
                {"type": "fill", "target": "password_input", "value": "invalid-password"},
                {"type": "click", "target": "submit_button"},
            ],
            "assertions": [
                {"type": "session_absent"},
                {"type": "protected_resource_denied", "resource": "/api/me"},
            ],
        },
        targets=targets,
        feature=feature,
        evidence=evidence,
        origin="llm",
    )
    if not good or good["origin"] != "llm":
        print("approved login spec should validate", file=sys.stderr)
        return 2
    bad_eval = validate_spec(
        {
            "name": "hack",
            "actions": [{"type": "eval", "code": "process.exit(0)"}],
            "assertions": [{"type": "session_absent"}],
        },
        targets=targets,
        feature=feature,
        evidence=evidence,
        origin="llm",
    )
    if bad_eval is not None:
        print("unknown actions must be rejected", file=sys.stderr)
        return 2
    bad_css = validate_spec(
        {
            "name": "invented selector",
            "actions": [
                {"type": "navigate", "path": "/login"},
                {"type": "fill", "target": "input.user", "value": "invalid@example.test"},
            ],
            "assertions": [{"type": "visible", "target": "email_input"}],
        },
        targets=targets,
        feature=feature,
        evidence=evidence,
        origin="llm",
    )
    if bad_css is not None:
        print("raw CSS targets must be rejected", file=sys.stderr)
        return 2
    bad_route = validate_spec(
        {
            "name": "off-catalog route",
            "actions": [{"type": "navigate", "path": "https://evil.test"}],
            "assertions": [{"type": "page_loaded"}],
        },
        targets=targets,
        feature=feature,
        evidence=evidence,
        origin="llm",
    )
    if bad_route is not None:
        print("absolute URLs must be rejected", file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, "selfTest": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
