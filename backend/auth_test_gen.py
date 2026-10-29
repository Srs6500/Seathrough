"""Build an executable Playwright spec from verified auth UI and routes.

Selectors come from source. Missing fields mean missing tests — the
generator will not invent a private-dashboard test id or a session check.
"""

from __future__ import annotations

import json
import re
from typing import Any

from file_graph import is_api_route_path, route_for_path
from spec_compiler import compile_feature_specs
from test_spec import targets_from_auth_evidence
from test_templates import auth_template_specs

EMAIL_INPUT = re.compile(
    r"<input\b[^>]*(?:type\s*=\s*[\"']email[\"']|name\s*=\s*[\"']email[\"']|"
    r"autoComplete\s*=\s*[\"']email[\"']|placeholder\s*=\s*[\"'][^\"']*email[^\"']*[\"']|"
    r"id\s*=\s*[\"']email[\"'])[^>]*>",
    re.I,
)
USERNAME_INPUT = re.compile(
    r"<input\b[^>]*(?:name\s*=\s*[\"']username[\"']|id\s*=\s*[\"']username[\"']|"
    r"autoComplete\s*=\s*[\"']username[\"'])[^>]*>",
    re.I,
)
PASSWORD_INPUT = re.compile(
    r"<input\b[^>]*(?:type\s*=\s*[\"']password[\"']|name\s*=\s*[\"']password[\"']|"
    r"id\s*=\s*[\"']password[\"'])[^>]*>",
    re.I,
)
LABEL_EMAIL = re.compile(r"<label\b[^>]*>\s*([^<]*email[^<]*)\s*</label>", re.I)
LABEL_PASSWORD = re.compile(r"<label\b[^>]*>\s*([^<]*password[^<]*)\s*</label>", re.I)
BUTTON_TEXT = re.compile(r"<button\b[^>]*>(.*?)</button>", re.I | re.S)
ARIA_BUTTON = re.compile(r"<button\b[^>]*aria-label\s*=\s*[\"']([^\"']+)[\"']", re.I)
TESTID = re.compile(r"data-testid\s*=\s*[\"']([^\"']+)[\"']", re.I)
FETCH_API = re.compile(r"""fetch\(\s*[`'"](/api/[^`'"]+)[`'"]""")
SESSION_API = re.compile(
    r"[`'\"/](/api/auth/session|/api/session|/auth/session)[`'\"]",
    re.I,
)
SESSION_COOKIE = re.compile(
    r"(next-auth\.session-token|__Secure-next-auth\.session-token|"
    r"sb-[a-z0-9-]+-auth-token|supabase-auth-token)",
    re.I,
)
NEXT_AUTH = re.compile(r"next-auth|getServerSession|getServerAuthSession", re.I)
STORAGE_TOKEN = re.compile(
    r"""(?:localStorage|sessionStorage)\.setItem\(\s*['"]([^'"]+)['"]""",
    re.I,
)


def _clean(path: Any) -> str:
    return str(path or "").replace("\\", "/").lstrip("./").strip()


def _paths_for(feature: dict[str, Any], catalog: dict[str, Any]) -> list[str]:
    paths = [_clean(path) for path in feature.get("primary_files") or []]
    related = set(feature.get("related_features") or [])
    for other in catalog.get("features") or []:
        name = str(other.get("name") or other.get("feature_id") or "").lower()
        linked = other.get("feature_id") in related or "dashboard" in name
        if not linked:
            continue
        for path in other.get("primary_files") or []:
            cleaned = _clean(path)
            if cleaned and cleaned not in paths:
                paths.append(cleaned)
    return paths


def _source_blob(paths: list[str], sources: dict[str, str]) -> str:
    return "\n".join(sources.get(path) or "" for path in paths)


def _first_route(feature: dict[str, Any], *needles: str) -> str | None:
    for route in feature.get("entry_points") or []:
        lowered = str(route).lower()
        if any(needle in lowered for needle in needles):
            return str(route)
    for path in feature.get("primary_files") or []:
        route = route_for_path(_clean(path))
        if route and any(needle in route.lower() for needle in needles):
            return route
    return None


def _button_name(source: str) -> str | None:
    for match in BUTTON_TEXT.finditer(source):
        text = re.sub(r"<[^>]+>", "", match.group(1)).strip()
        if re.search(r"log\s*in|sign\s*in|continue|submit", text, re.I):
            return text
    aria = ARIA_BUTTON.search(source)
    if aria:
        return aria.group(1).strip()
    return None


def _identity_field(source: str) -> dict[str, str] | None:
    if EMAIL_INPUT.search(source) or LABEL_EMAIL.search(source):
        return {
            "kind": "email",
            "locator": 'input[type="email"], input[name="email"]',
        }
    if USERNAME_INPUT.search(source):
        return {
            "kind": "username",
            "locator": 'input[name="username"], input[id="username"]',
        }
    return None


def _storage_keys(source: str) -> list[str]:
    keys: list[str] = []
    for match in STORAGE_TOKEN.finditer(source or ""):
        key = match.group(1).strip()
        if not key or key in keys:
            continue
        if re.search(r"token|auth|session|jwt|access", key, re.I):
            keys.append(key)
    return keys[:4]


def _session_api(source: str, paths: list[str]) -> str | None:
    match = SESSION_API.search(source)
    if match:
        return match.group(1)
    if NEXT_AUTH.search(source):
        return "/api/auth/session"
    for path in paths:
        route = route_for_path(path)
        if route in {"/api/auth/session", "/api/session"}:
            return route
    return None


def _protected_apis(source: str, paths: list[str], session_api: str | None) -> list[str]:
    found: list[str] = []
    skip = {session_api, "/api/auth/session", "/api/session", "/api/auth/callback"}
    for match in FETCH_API.finditer(source):
        route = match.group(1).split("?")[0]
        if route not in skip and route not in found:
            found.append(route)
    for path in paths:
        if not is_api_route_path(path):
            continue
        route = route_for_path(path)
        if route and route not in skip and route not in found:
            found.append(route)
    return found[:4]


def _private_markers(paths: list[str], sources: dict[str, str]) -> list[dict[str, str]]:
    markers: list[dict[str, str]] = []
    for path in paths:
        lowered = path.lower()
        if not any(part in lowered for part in ("dashboard", "admin", "settings", "account")):
            continue
        text = sources.get(path) or ""
        for testid in TESTID.findall(text):
            if testid and {"testid": testid, "source": path} not in markers:
                markers.append({"testid": testid, "source": path})
    return markers[:3]


def infer_auth_evidence(
    feature: dict[str, Any],
    catalog: dict[str, Any] | None = None,
    sources: dict[str, str] | None = None,
) -> dict[str, Any]:
    catalog = catalog if isinstance(catalog, dict) else {}
    source_map = {_clean(key): value for key, value in (sources or {}).items() if value}
    paths = _paths_for(feature, catalog)
    blob = _source_blob(paths, source_map)
    identity = _identity_field(blob)
    password = bool(PASSWORD_INPUT.search(blob) or LABEL_PASSWORD.search(blob))
    session_api = _session_api(blob, paths)
    cookie = SESSION_COOKIE.search(blob)
    login_route = _first_route(feature, "login", "signin", "sign-in") or "/login"
    dashboard = None
    for route in feature.get("entry_points") or []:
        if "/dashboard" in str(route).lower():
            dashboard = str(route)
    if not dashboard:
        related = set(feature.get("related_features") or [])
        for other in catalog.get("features") or []:
            name = str(other.get("name") or other.get("feature_id") or "").lower()
            linked = other.get("feature_id") in related or "dashboard" in name
            if not linked:
                continue
            for route in other.get("entry_points") or []:
                if "/dashboard" in str(route).lower():
                    dashboard = str(route)
    source_files = [
        path
        for path in paths
        if re.search(r"login|signup|auth|session|dashboard|middleware", path, re.I)
    ]
    return {
        "login_route": login_route,
        "dashboard_route": dashboard,
        "identity": identity,
        "has_password": password,
        "submit_name": _button_name(blob),
        "has_form": bool(re.search(r"<form\b|loginform", blob, re.I)),
        "session_api": session_api,
        "session_cookie": cookie.group(1) if cookie else None,
        "storage_keys": _storage_keys(blob),
        "protected_apis": _protected_apis(blob, paths, session_api),
        "private_markers": _private_markers(paths, source_map),
        "source_files": source_files or paths[:4],
    }


def _auth_feature(evidence: dict[str, Any]) -> dict[str, Any]:
    routes = [
        str(item)
        for item in (
            evidence.get("login_route"),
            evidence.get("dashboard_route"),
            *(evidence.get("protected_apis") or []),
        )
        if item
    ]
    return {
        "feature_id": "authentication",
        "entry_points": routes,
    }


def generate_auth_spec(evidence: dict[str, Any]) -> str:
    targets = targets_from_auth_evidence(evidence)
    specs = auth_template_specs(evidence, targets)
    _approved, source = compile_feature_specs(
        specs,
        feature=_auth_feature(evidence),
        targets=targets,
        evidence=evidence,
        origin="template",
    )
    return source


def planned_generated_tests(evidence: dict[str, Any]) -> list[dict[str, Any]]:
    """The claims the generated spec can actually make."""
    targets = targets_from_auth_evidence(evidence)
    specs = auth_template_specs(evidence, targets)
    approved, source = compile_feature_specs(
        specs,
        feature=_auth_feature(evidence),
        targets=targets,
        evidence=evidence,
        origin="template",
    )
    tests: list[dict[str, Any]] = []
    for spec in approved:
        if f'test({json.dumps(spec["name"])}' not in source and f'test("{spec["name"]}"' not in source:
            continue
        api = next(
            (
                item.get("resource")
                for item in spec.get("assertions") or []
                if item.get("type") == "protected_resource_denied"
            ),
            None,
        )
        tests.append(
            {
                "id": spec.get("id") or spec["name"],
                "name": spec["name"],
                "type": "browser",
                "assertion": spec.get("assertion") or spec["name"],
                "origin": "template",
                "api": api,
            }
        )
    return tests


def self_test() -> int:
    import sys

    rich = infer_auth_evidence(
        {
            "feature_id": "authentication",
            "entry_points": ["/login"],
            "primary_files": [
                "app/login/page.tsx",
                "components/LoginForm.tsx",
                "lib/auth.ts",
            ],
            "related_features": ["dashboard"],
        },
        {
            "features": [
                {
                    "feature_id": "dashboard",
                    "entry_points": ["/dashboard"],
                    "primary_files": [
                        "app/dashboard/page.tsx",
                        "app/api/stats/route.ts",
                    ],
                }
            ]
        },
        {
            "components/LoginForm.tsx": (
                "export function LoginForm() {\n"
                "  return (\n"
                "    <form>\n"
                '      <label>Email</label>\n'
                '      <input type="email" name="email" />\n'
                "      <label>Password</label>\n"
                '      <input type="password" name="password" />\n'
                "      <button type=\"submit\">Sign in</button>\n"
                "    </form>\n"
                "  );\n"
                "}\n"
            ),
            "lib/auth.ts": (
                "import { getServerSession } from \"next-auth\";\n"
                "export function signIn() { return getServerSession(); }\n"
                "localStorage.setItem(\"access_token\", token);\n"
            ),
            "app/dashboard/page.tsx": (
                "export default function DashboardPage() {\n"
                '  return <div data-testid="private-dashboard">Secret</div>;\n'
                "}\n"
            ),
            "app/api/stats/route.ts": "export async function GET() { return Response.json({}); }\n",
        },
    )
    if rich["identity"]["kind"] != "email" or not rich["has_password"]:
        print("email/password form should be inferred", file=sys.stderr)
        return 2
    if rich["session_api"] != "/api/auth/session":
        print(f"next-auth should infer session API, got {rich['session_api']}", file=sys.stderr)
        return 2
    if "/api/stats" not in rich["protected_apis"]:
        print(f"dashboard stats API should be discovered, got {rich['protected_apis']}", file=sys.stderr)
        return 2
    if not any(item.get("testid") == "private-dashboard" for item in rich["private_markers"]):
        print("private testid must come from dashboard source", file=sys.stderr)
        return 2
    spec = generate_auth_spec(rich)
    if "type=\\\"email\\\"" not in spec and 'type="email"' not in spec:
        print("generated spec must use the inferred email locator", file=sys.stderr)
        return 2
    if "private-dashboard" not in spec:
        print("generated spec must use the discovered test id", file=sys.stderr)
        return 2
    if "noWaitAfter: true" not in spec or "timeout: 5000" not in spec:
        print("invalid-login URL check must not wait the full 30s", file=sys.stderr)
        return 2
    if "/api/auth/session" not in spec:
        print("session test must use the discovered session API", file=sys.stderr)
        return 2
    if "access_token" not in spec:
        print("localStorage auth keys must become a session assertion", file=sys.stderr)
        return 2
    if "/api/stats" not in spec:
        print("API test must use the discovered stats route", file=sys.stderr)
        return 2

    sparse = infer_auth_evidence(
        {
            "feature_id": "authentication",
            "entry_points": ["/login"],
            "primary_files": ["components/LoginForm.tsx"],
            "related_features": [],
        },
        {"features": []},
        {
            "components/LoginForm.tsx": (
                'export function LoginForm() { return <button onClick={() => signIn()}>Go</button>; }\n'
            )
        },
    )
    sparse_spec = generate_auth_spec(sparse)
    if "invalid@example.test" in sparse_spec:
        print("must not invent a credential test without email/password fields", file=sys.stderr)
        return 2
    if "private-dashboard" in sparse_spec:
        print("must not invent a private dashboard test id", file=sys.stderr)
        return 2
    if "no_authenticated_session" in [item["assertion"] for item in planned_generated_tests(sparse)]:
        print("sparse login cannot claim a session assertion", file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, "selfTest": True}))
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
