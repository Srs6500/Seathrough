"""Compile approved restricted specs into an allowlisted Playwright file."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from test_spec import validate_spec


def _js_str(value: str) -> str:
    return json.dumps(value)


def _fill_js(value: str) -> str:
    if value.startswith("env:"):
        key = value[4:].strip()
        env_name = (
            "REPO_SCAN_TEST_PASSWORD"
            if key in {"TEST_PASSWORD", "REPO_SCAN_TEST_PASSWORD"}
            else "REPO_SCAN_TEST_USER"
        )
        return f'(process.env.{env_name} || "")'
    return _js_str(value)


def _js_regex(pattern: str, flags: str = "i") -> str:
    return f"new RegExp({json.dumps(pattern)}, {json.dumps(flags)})"


def _url_re(route: str) -> str:
    return _js_regex(str(route).rstrip("/") + r"(?:/|$|\?)", "")


def _locator(target: dict[str, str]) -> str:
    kind = str(target.get("kind") or "css")
    if kind == "testid":
        return f"page.getByTestId({_js_str(str(target.get('locator') or ''))})"
    if kind == "role":
        role = str(target.get("role") or "button")
        name = str(target.get("name") or role)
        return f"page.getByRole({_js_str(role)}, {{ name: {_js_regex(name)} }})"
    return f"page.locator({_js_str(str(target.get('locator') or 'body'))})"


def _needs_page(spec: dict[str, Any]) -> bool:
    if spec.get("actions"):
        return True
    return any(
        item.get("type") not in {"protected_resource_denied"}
        for item in spec.get("assertions") or []
    )


def _compile_action(action: dict[str, Any], targets: dict[str, dict[str, str]]) -> list[str]:
    kind = action.get("type")
    if kind == "navigate":
        path = str(action["path"])
        return [
            f"  response = await page.goto({_js_str(path)});",
            f"  await assertScannedApp(page, {_js_str(path)});",
        ]
    if kind == "fill":
        target = targets[str(action["target"])]
        return [f"  await {_locator(target)}.fill({_fill_js(str(action['value']))});"]
    if kind == "click":
        target = targets[str(action["target"])]
        return [
            f"  await {_locator(target)}.click({{ noWaitAfter: true, timeout: 8000 }});",
            "  await page.waitForLoadState(\"domcontentloaded\", { timeout: 5000 }).catch(() => {});",
        ]
    if kind == "press":
        target = targets[str(action["target"])]
        return [f"  await {_locator(target)}.press({_js_str(str(action['key']))});"]
    timeout = action.get("timeout_ms") or 5000
    return [
        f"  await page.waitForLoadState(\"domcontentloaded\", {{ timeout: {int(timeout)} }}).catch(() => {{}});"
    ]


def _compile_assertion(
    assertion: dict[str, Any],
    *,
    targets: dict[str, dict[str, str]],
    evidence: dict[str, Any],
    used_page: bool,
) -> list[str]:
    kind = assertion.get("type")
    if kind == "visible":
        return [f"  await expect({_locator(targets[str(assertion['target'])])}).toBeVisible();"]
    if kind == "hidden":
        return [
            f"  await expect({_locator(targets[str(assertion['target'])])}).not.toBeVisible();"
        ]
    if kind == "url_not_match":
        return [
            f"  await expect(page).not.toHaveURL({_url_re(str(assertion['path']))}, {{ timeout: 5000 }});"
        ]
    if kind == "url_match":
        return [
            f"  await expect(page).toHaveURL({_url_re(str(assertion['path']))}, {{ timeout: 5000 }});"
        ]
    if kind == "page_loaded":
        return [
            "  const status = response ? response.status() : 200;",
            "  expect(status < 400 || [401, 403].includes(status)).toBeTruthy();",
        ]
    if kind == "text_contains":
        return [
            f"  await expect(page.locator(\"body\")).toContainText({_js_str(str(assertion['text']))}, {{ timeout: 5000 }});"
        ]
    if kind == "protected_resource_denied":
        resource = str(assertion["resource"])
        client = "page.request" if used_page else "request"
        return [
            f"  const path = {_js_str(resource)};",
            "  const url = apiOrigin ? `${apiOrigin}${path}` : path;",
            f"  const denied = await {client}.get(url);",
            "  expect([401, 403, 302, 307, 308]).toContain(denied.status());",
        ]
    if kind in {"session_absent", "session_present"}:
        expect_user = "toBeFalsy" if kind == "session_absent" else "toBeTruthy"
        expect_count = "toBe(0)" if kind == "session_absent" else "toBeGreaterThan(0)"
        expect_stored = "toBeFalsy" if kind == "session_absent" else "toBeTruthy"
        lines: list[str] = []
        session_api = evidence.get("session_api")
        cookie = evidence.get("session_cookie")
        storage_keys = [str(item) for item in evidence.get("storage_keys") or [] if item]
        if session_api:
            getter = "page.request.get" if used_page else "request.get"
            lines.extend(
                [
                    f"  const session = await {getter}({_js_str(str(session_api))});",
                    "  if (session.status() !== 404) {",
                    "    const body = await session.json().catch(() => ({}));",
                    f"    expect(body.user ?? body.data?.user ?? null).{expect_user}();",
                    "  } else {",
                    "    throw new Error(\"Session API was referenced in source but is not served.\");",
                    "  }",
                ]
            )
        if cookie:
            lines.extend(
                [
                    "  const cookies = await page.context().cookies();",
                    f"  expect(cookies.filter((item) => item.name === {_js_str(str(cookie))} && item.value).length).{expect_count};",
                ]
            )
        if storage_keys:
            lines.extend(
                [
                    f"  const keys = {json.dumps(storage_keys)};",
                    "  const stored = await page.evaluate((names) => names.some((key) => "
                    "Boolean(localStorage.getItem(key) || sessionStorage.getItem(key))), keys);",
                    f"  expect(stored).{expect_stored}();",
                ]
            )
        return lines
    return []


def compile_specs(
    specs: list[dict[str, Any]],
    *,
    targets: dict[str, dict[str, str]],
    evidence: dict[str, Any],
) -> str:
    usable = [item for item in specs if isinstance(item, dict) and item.get("assertions")]
    if not usable:
        return ""
    needs_api = any(
        any(row.get("type") == "protected_resource_denied" for row in item.get("assertions") or [])
        for item in usable
    )
    lines = ['import { test, expect } from "@playwright/test";', ""]
    if any(
        any(row.get("type") == "navigate" for row in item.get("actions") or [])
        for item in usable
    ):
        lines.extend(
            [
                "async function assertScannedApp(page, intendedPath) {",
                "  const title = await page.title();",
                '  const brand = page.getByRole("link", { name: "SeeThrough" });',
                "  if (/SeeThrough/i.test(title) && (await brand.count())) {",
                '    throw new Error("SEETHROUGH_WRONG_APP");',
                "  }",
                '  let here = "/";',
                "  try { here = new URL(page.url()).pathname || \"/\"; } catch {}",
                "  const loginHere = /^\\/(login|signin|sign-in|mfa-challenge)(?:\\/|$)/i.test(here);",
                "  const loginIntended = /^\\/(login|signin|sign-in|mfa-challenge)(?:\\/|$)/i.test(intendedPath);",
                "  if (loginHere && !loginIntended) {",
                '    throw new Error("LOGIN_WALL");',
                "  }",
                "}",
                "",
            ]
        )
    if needs_api:
        lines.append(
            'const apiOrigin = (process.env.REPO_SCAN_TEST_API_URL || "").replace(/\\/$/, "");'
        )
        lines.append("")
    for spec in usable:
        name = str(spec.get("name") or "Generated check")
        use_page = _needs_page(spec)
        fixture = "page" if use_page else "request"
        lines.append(f"test({_js_str(name)}, async ({{ {fixture} }}) => {{")
        actions = spec.get("actions") or []
        navigated = any(item.get("type") == "navigate" for item in actions)
        if navigated:
            lines.append("  let response;")
        for action in actions:
            lines.extend(_compile_action(action, targets))
        for assertion in spec.get("assertions") or []:
            if assertion.get("type") == "page_loaded" and not navigated:
                continue
            lines.extend(
                _compile_assertion(
                    assertion,
                    targets=targets,
                    evidence=evidence,
                    used_page=use_page,
                )
            )
        lines.append("});")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def compile_feature_specs(
    raw_specs: list[dict[str, Any]],
    *,
    feature: dict[str, Any],
    targets: dict[str, dict[str, str]],
    evidence: dict[str, Any],
    origin: str,
) -> tuple[list[dict[str, Any]], str]:
    approved: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_specs:
        valid = validate_spec(
            item,
            targets=targets,
            feature=feature,
            evidence=evidence,
            origin=str(item.get("origin") or origin),
        )
        if not valid:
            continue
        name = valid["name"]
        if name in seen:
            continue
        seen.add(name)
        approved.append(valid)
    return approved, compile_specs(approved, targets=targets, evidence=evidence)


def self_test() -> int:
    from test_spec import targets_from_auth_evidence

    evidence = {
        "login_route": "/login",
        "dashboard_route": "/dashboard",
        "identity": {
            "kind": "email",
            "locator": 'input[type="email"], input[name="email"]',
        },
        "has_password": True,
        "submit_name": "Sign in",
        "has_form": True,
        "session_api": "/api/auth/session",
        "storage_keys": ["access_token"],
        "protected_apis": ["/api/stats"],
        "private_markers": [{"testid": "private-dashboard"}],
    }
    targets = targets_from_auth_evidence(evidence)
    feature = {"feature_id": "authentication", "entry_points": ["/login", "/dashboard"]}
    specs = [
        {
            "name": "Login page renders",
            "origin": "template",
            "actions": [{"type": "navigate", "path": "/login"}],
            "assertions": [
                {"type": "visible", "target": "email_input"},
                {"type": "visible", "target": "password_input"},
            ],
        },
        {
            "name": "Invalid credentials do not open the dashboard",
            "origin": "template",
            "actions": [
                {"type": "navigate", "path": "/login"},
                {"type": "fill", "target": "email_input", "value": "invalid@example.test"},
                {"type": "fill", "target": "password_input", "value": "incorrect-password"},
                {"type": "click", "target": "submit_button"},
            ],
            "assertions": [{"type": "url_not_match", "path": "/dashboard"}],
        },
        {
            "name": "Invalid credentials do not create a session",
            "origin": "template",
            "actions": [
                {"type": "navigate", "path": "/login"},
                {"type": "fill", "target": "email_input", "value": "invalid@example.test"},
                {"type": "fill", "target": "password_input", "value": "incorrect-password"},
                {"type": "click", "target": "submit_button"},
            ],
            "assertions": [{"type": "session_absent"}],
        },
        {
            "name": "Anonymous request to /api/stats is unauthorized",
            "origin": "template",
            "actions": [],
            "assertions": [
                {"type": "protected_resource_denied", "resource": "/api/stats"}
            ],
        },
    ]
    approved, source = compile_feature_specs(
        specs, feature=feature, targets=targets, evidence=evidence, origin="template"
    )
    if len(approved) != 4:
        print(f"expected 4 compiled specs, got {len(approved)}", file=sys.stderr)
        return 2
    if "invalid@example.test" not in source:
        print("compiler must emit the approved invalid email", file=sys.stderr)
        return 2
    os.environ["REPO_SCAN_TEST_USER"] = "trader@example.test"
    os.environ["REPO_SCAN_TEST_PASSWORD"] = "do-not-emit"
    _signed, signed_src = compile_feature_specs(
        [
            {
                "name": "Signed-in form loads",
                "origin": "template",
                "actions": [
                    {"type": "navigate", "path": "/login"},
                    {
                        "type": "fill",
                        "target": "email_input",
                        "value": "env:REPO_SCAN_TEST_USER",
                    },
                    {
                        "type": "fill",
                        "target": "password_input",
                        "value": "env:TEST_PASSWORD",
                    },
                    {"type": "click", "target": "submit_button"},
                ],
                "assertions": [{"type": "page_loaded"}],
            }
        ],
        feature=feature,
        targets=targets,
        evidence=evidence,
        origin="template",
    )
    os.environ.pop("REPO_SCAN_TEST_USER", None)
    os.environ.pop("REPO_SCAN_TEST_PASSWORD", None)
    if "do-not-emit" in signed_src or "trader@example.test" in signed_src:
        print("test login must stay in env, not the spec file", file=sys.stderr)
        return 2
    if "process.env.REPO_SCAN_TEST_PASSWORD" not in signed_src:
        print("compiler must read the test password from env", file=sys.stderr)
        return 2
    twice, twice_src = compile_feature_specs(
        [
            {
                "name": "Dashboard after login",
                "origin": "template",
                "actions": [
                    {"type": "navigate", "path": "/login"},
                    {"type": "fill", "target": "email_input", "value": "invalid@example.test"},
                    {"type": "fill", "target": "password_input", "value": "incorrect-password"},
                    {"type": "click", "target": "submit_button"},
                    {"type": "navigate", "path": "/dashboard"},
                ],
                "assertions": [{"type": "page_loaded"}],
            }
        ],
        feature=feature,
        targets=targets,
        evidence=evidence,
        origin="template",
    )
    if twice_src.count("const response") != 0:
        print("login-then-feature must not redeclare response", file=sys.stderr)
        return 2
    if twice_src.count("let response;") < 1 or twice_src.count("response = await page.goto") < 2:
        print("login-then-feature should reuse one response variable", file=sys.stderr)
        return 2
    if "eval(" in source or "Function(" in source:
        print("compiler must not emit dynamic eval", file=sys.stderr)
        return 2
    if "/api/auth/session" not in source or "access_token" not in source:
        print("session_absent must use analysis evidence", file=sys.stderr)
        return 2
    if "noWaitAfter: true" not in source:
        print("click must not wait the full navigation timeout", file=sys.stderr)
        return 2
    if "SEETHROUGH_WRONG_APP" not in source or "LOGIN_WALL" not in source:
        print("compiled specs must detect SeeThrough and login walls", file=sys.stderr)
        return 2
    rejected, empty = compile_feature_specs(
        [
            {
                "name": "pwn",
                "actions": [{"type": "navigate", "path": "/login"}],
                "assertions": [{"type": "visible", "target": "document.body"}],
            }
        ],
        feature=feature,
        targets=targets,
        evidence=evidence,
        origin="llm",
    )
    if rejected or empty:
        print("unknown targets must not compile", file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, "selfTest": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
