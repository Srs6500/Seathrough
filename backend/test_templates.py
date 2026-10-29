"""Known family templates. They emit restricted specs, not Playwright."""

from __future__ import annotations

import json
import sys
from typing import Any


def _login_fills(targets: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    actions: list[dict[str, str]] = []
    if "email_input" in targets:
        actions.append(
            {
                "type": "fill",
                "target": "email_input",
                "value": "invalid@example.test",
            }
        )
    elif "username_input" in targets:
        actions.append(
            {"type": "fill", "target": "username_input", "value": "invalid-user"}
        )
    if "password_input" in targets:
        actions.append(
            {
                "type": "fill",
                "target": "password_input",
                "value": "incorrect-password",
            }
        )
    return actions


def auth_template_specs(
    evidence: dict[str, Any],
    targets: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    login = str(evidence.get("login_route") or "/login")
    dashboard = evidence.get("dashboard_route")
    specs: list[dict[str, Any]] = []
    render_asserts: list[dict[str, str]] = []
    if "email_input" in targets:
        render_asserts.append({"type": "visible", "target": "email_input"})
    if "username_input" in targets and "email_input" not in targets:
        render_asserts.append({"type": "visible", "target": "username_input"})
    if "password_input" in targets:
        render_asserts.append({"type": "visible", "target": "password_input"})
    if not render_asserts and "form" in targets:
        render_asserts.append({"type": "visible", "target": "form"})
    if not render_asserts and "submit_button" in targets:
        render_asserts.append({"type": "visible", "target": "submit_button"})
    if not render_asserts:
        render_asserts.append({"type": "page_loaded"})
    specs.append(
        {
            "id": "auth-gen-001",
            "name": "Login page renders",
            "feature": "login",
            "origin": "template",
            "actions": [{"type": "navigate", "path": login}],
            "assertions": render_asserts,
        }
    )
    fills = _login_fills(targets)
    can_submit = bool(fills) and "password_input" in targets and "submit_button" in targets
    if can_submit and dashboard:
        specs.append(
            {
                "id": "auth-gen-002",
                "name": "Invalid credentials do not open the dashboard",
                "feature": "login",
                "origin": "template",
                "actions": [
                    {"type": "navigate", "path": login},
                    *fills,
                    {"type": "click", "target": "submit_button"},
                ],
                "assertions": [{"type": "url_not_match", "path": str(dashboard)}],
            }
        )
    if can_submit and (
        evidence.get("session_api")
        or evidence.get("session_cookie")
        or evidence.get("storage_keys")
    ):
        specs.append(
            {
                "id": "auth-gen-003",
                "name": "Invalid credentials do not create a session",
                "feature": "login",
                "origin": "template",
                "actions": [
                    {"type": "navigate", "path": login},
                    *fills,
                    {"type": "click", "target": "submit_button"},
                ],
                "assertions": [{"type": "session_absent"}],
            }
        )
    if dashboard:
        if "private_marker" in targets:
            assertions: list[dict[str, str]] = [
                {"type": "hidden", "target": "private_marker"}
            ]
        else:
            assertions = [{"type": "url_not_match", "path": str(dashboard)}]
        specs.append(
            {
                "id": "auth-gen-004",
                "name": "Anonymous visit does not expose verified private UI",
                "feature": "login",
                "origin": "template",
                "actions": [{"type": "navigate", "path": str(dashboard)}],
                "assertions": assertions,
            }
        )
    for index, api in enumerate(evidence.get("protected_apis") or [], start=1):
        specs.append(
            {
                "id": f"auth-gen-api-{index:02d}",
                "name": f"Anonymous request to {api} is unauthorized",
                "feature": "login",
                "origin": "template",
                "actions": [],
                "assertions": [
                    {"type": "protected_resource_denied", "resource": str(api)}
                ],
            }
        )
    return specs


def _route_spec(
    *,
    spec_id: str,
    name: str,
    route: str,
    target: str | None,
    feature: str,
) -> dict[str, Any]:
    assertions: list[dict[str, str]]
    if target:
        assertions = [{"type": "visible", "target": target}]
    else:
        assertions = [{"type": "page_loaded"}]
    return {
        "id": spec_id,
        "name": name,
        "feature": feature,
        "origin": "template",
        "actions": [{"type": "navigate", "path": route}],
        "assertions": assertions,
    }


def template_specs(
    family: str,
    feature: dict[str, Any],
    evidence: dict[str, Any],
    targets: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    if family == "auth":
        return auth_template_specs(evidence, targets)
    route = str(
        evidence.get("primary_route")
        or next((item for item in (evidence.get("routes") or []) if item), "")
        or ""
    )
    if not route.startswith("/"):
        return []
    fid = str(feature.get("feature_id") or family or "feature")
    if family == "payments":
        return [
            _route_spec(
                spec_id=f"{fid}-b01",
                name="Checkout page loads",
                route=route,
                target="form" if "form" in targets else None,
                feature="payments",
            )
        ]
    if family == "upload":
        return [
            _route_spec(
                spec_id=f"{fid}-b01",
                name="Upload control is visible",
                route=route,
                target="file_input" if "file_input" in targets else None,
                feature="uploads",
            )
        ]
    if family == "search":
        return [
            _route_spec(
                spec_id=f"{fid}-b01",
                name="Search control is visible",
                route=route,
                target="search_input" if "search_input" in targets else None,
                feature="search",
            )
        ]
    if family == "chatbot":
        return [
            _route_spec(
                spec_id=f"{fid}-b01",
                name="Chat composer is visible",
                route=route,
                target="composer" if "composer" in targets else None,
                feature="chat",
            )
        ]
    if family in {"crud", "forms"}:
        return [
            _route_spec(
                spec_id=f"{fid}-b01",
                name="Feature form loads",
                route=route,
                target=_feature_visible_target(targets),
                feature=family,
            )
        ]
    return [
        _route_spec(
            spec_id=f"{fid}-b01",
            name="Feature route loads",
            route=route,
            target=_feature_visible_target(targets),
            feature=family,
        )
    ]


def _feature_visible_target(targets: dict[str, dict[str, str]]) -> str | None:
    """Prefer a real control. A generic <form> also matches login pages."""
    for key in (
        "create_button",
        "symbol_input",
        "amount_input",
        "title_input",
        "name_input",
        "search_input",
        "file_input",
        "composer",
    ):
        if key in targets:
            return key
    return None


def self_test() -> int:
    evidence = {
        "login_route": "/login",
        "dashboard_route": "/dashboard",
        "session_api": "/api/auth/session",
        "protected_apis": ["/api/me"],
        "storage_keys": ["access_token"],
    }
    targets = {
        "email_input": {"kind": "css", "locator": 'input[type="email"]'},
        "password_input": {"kind": "css", "locator": 'input[type="password"]'},
        "submit_button": {"kind": "role", "role": "button", "name": "Sign in"},
        "private_marker": {"kind": "testid", "locator": "private-dashboard"},
    }
    specs = auth_template_specs(evidence, targets)
    names = [item["name"] for item in specs]
    if "Login page renders" not in names:
        print("auth template must include login render", file=sys.stderr)
        return 2
    if "Invalid credentials do not create a session" not in names:
        print("auth template must claim session_absent when keys exist", file=sys.stderr)
        return 2
    session = next(
        item for item in specs if item["name"] == "Invalid credentials do not create a session"
    )
    if session["assertions"] != [{"type": "session_absent"}]:
        print("session test must be a restricted assertion", file=sys.stderr)
        return 2
    sparse = auth_template_specs({"login_route": "/login"}, {"submit_button": {"kind": "role", "role": "button", "name": "Go"}})
    if any("invalid@example.test" in str(item) for item in sparse):
        print("template must not fill credentials without identity fields", file=sys.stderr)
        return 2
    crud = template_specs(
        "crud",
        {"feature_id": "orders", "entry_points": ["/orders"]},
        {"primary_route": "/orders", "routes": ["/orders"]},
        {"create_button": {"kind": "role", "role": "button", "name": "Create"}},
    )
    if not crud or crud[0]["actions"][0]["path"] != "/orders":
        print("CRUD template should navigate the list route", file=sys.stderr)
        return 2
    form_only = template_specs(
        "crud",
        {"feature_id": "orders", "entry_points": ["/orders"]},
        {"primary_route": "/orders", "routes": ["/orders"]},
        {"form": {"kind": "css", "locator": "form"}},
    )
    if form_only and any(
        item.get("type") == "visible" for item in form_only[0].get("assertions") or []
    ):
        print("a generic form locator must not be the order-entry check", file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, "selfTest": True, "authSpecs": len(specs)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
