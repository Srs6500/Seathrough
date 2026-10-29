"""Feature Testing Engine: claims → static/runtime/browser → card results.

Discovering a feature does not prove it works. Static checks read stored
source. Integration and Playwright browser tests stay blocked until a
sandbox, test user, or running app is available.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import Any

from llm_test_spec import propose_restricted_specs
from playwright_worker import (
    is_seethrough_base_url,
    normalize_result,
    run_playwright_test_sync,
    worker_workdir,
    write_playwright_project,
)
from repo_checks import catalog_repo_checks, index_repo_artifacts, run_feature_repo_tests
from spec_compiler import compile_feature_specs
from test_templates import template_specs
from ui_evidence import infer_feature_evidence

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_BACKEND_DIR)
_RUNTIME_SCRIPT = os.path.join(_REPO_ROOT, "scripts", "run-feature-runtime.mjs")

STATUSES = ("pass", "fail", "inconclusive", "blocked")
FEATURE_STATUSES = ("not_tested", "passed", "failed", "inconclusive", "blocked")

AUTH_HINTS = ("auth", "login", "signup", "signin", "sign-in", "register", "logout")
PAY_HINTS = ("payment", "checkout", "stripe", "billing", "cart")
DASHBOARD_HINTS = ("dashboard", "admin", "orders", "accounts")
SEARCH_HINTS = ("search",)
UPLOAD_HINTS = ("upload", "file")
SETTINGS_HINTS = ("settings", "preferences")
CHAT_HINTS = ("chat", "assistant", "bot", "llm")
REACT_FALSE_CRUD = {
    "createcontext",
    "createroot",
    "createelement",
    "createportal",
}

PROTECTION_HINTS = re.compile(
    r"protectedroute|getserversession|requireauth|middleware|redirect\(|"
    r"unauthenticated|usebsession|auth\(\)|clerk|next-auth",
    re.I,
)
FORM_HINTS = re.compile(
    r"<form\b|loginform|password|type=[\"']password[\"']|signin|signup|sign-in",
    re.I,
)
WEBHOOK_HINTS = re.compile(r"webhook|stripe\.webhooks|constructevent", re.I)
CRUD_OP_HINTS = re.compile(
    r"handle(Create|Update|Delete|Remove)|"
    r"\b(create|update|delete|remove)(Order|User|Item|Record|Row|Post|Account|Entry|Todo)\b|"
    r"export (async )?function (create|update|delete|remove)(Order|User|Item|Record|Entry)\w*|"
    r"prisma\.\w+\.(create|update|delete)",
    re.I,
)


def _clean(path: Any) -> str:
    return str(path or "").replace("\\", "/").lstrip("./").strip()


def _blob(feature: dict[str, Any]) -> str:
    parts = [
        str(feature.get("feature_id") or ""),
        str(feature.get("name") or ""),
        " ".join(str(item) for item in feature.get("entry_points") or []),
        " ".join(_clean(item) for item in feature.get("primary_files") or []),
    ]
    return " ".join(parts).lower()


def _has_crud_ops(
    feature: dict[str, Any],
    sources: dict[str, str] | None = None,
    file_map: dict[str, dict[str, Any]] | None = None,
) -> bool:
    paths = [_clean(path) for path in feature.get("primary_files") or []]
    source = _joined_source(paths, sources or {})
    if CRUD_OP_HINTS.search(source):
        return True
    for name in _symbols(paths, file_map or {}):
        lowered = name.lower()
        if lowered in REACT_FALSE_CRUD:
            continue
        if re.match(
            r"^(create|update|delete|remove)(order|user|item|record|row|post|account|entry|todo)",
            lowered,
        ):
            return True
    return False


def detect_family(
    feature: dict[str, Any],
    sources: dict[str, str] | None = None,
    file_map: dict[str, dict[str, Any]] | None = None,
) -> str:
    blob = _blob(feature)
    if any(hint in blob for hint in AUTH_HINTS):
        return "auth"
    if any(hint in blob for hint in PAY_HINTS):
        return "payments"
    if any(hint in blob for hint in SEARCH_HINTS):
        return "search"
    if any(hint in blob for hint in UPLOAD_HINTS):
        return "upload"
    if any(hint in blob for hint in SETTINGS_HINTS):
        return "settings"
    if any(hint in blob for hint in CHAT_HINTS):
        return "chatbot"
    if _has_crud_ops(feature, sources, file_map) or "crud" in blob:
        return "crud"
    if any(hint in blob for hint in DASHBOARD_HINTS):
        return "dashboard"
    paths = [_clean(path) for path in feature.get("primary_files") or []]
    if FORM_HINTS.search(_joined_source(paths, sources or {})):
        return "forms"
    return "unknown"


def _file_map(files: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in files or []:
        if not isinstance(row, dict):
            continue
        path = _clean(row.get("path"))
        if path:
            out[path] = row
    return out


def _joined_source(paths: list[str], sources: dict[str, str]) -> str:
    chunks = [sources.get(path) or "" for path in paths]
    return "\n".join(chunks)


def _symbols(paths: list[str], file_map: dict[str, dict[str, Any]]) -> set[str]:
    names: set[str] = set()
    for path in paths:
        for item in (file_map.get(path) or {}).get("symbols") or []:
            if isinstance(item, dict) and item.get("name"):
                names.add(str(item["name"]))
    return names


def _has_route(feature: dict[str, Any], *needles: str) -> bool:
    routes = " ".join(str(item) for item in feature.get("entry_points") or []).lower()
    files = " ".join(_clean(item) for item in feature.get("primary_files") or []).lower()
    blob = f"{routes} {files}"
    return any(needle in blob for needle in needles)


def _private_route_evidence(feature: dict[str, Any], catalog: dict[str, Any]) -> list[str]:
    """Routes that look private — never assume every page is protected."""
    hits: list[str] = []
    for route in feature.get("entry_points") or []:
        lowered = str(route).lower()
        if any(part in lowered for part in ("/dashboard", "/settings", "/admin", "/account")):
            hits.append(str(route))
    related = set(feature.get("related_features") or [])
    for other in catalog.get("features") or []:
        if other.get("feature_id") not in related:
            continue
        for route in other.get("entry_points") or []:
            lowered = str(route).lower()
            if any(part in lowered for part in ("/dashboard", "/settings", "/admin")):
                hits.append(str(route))
    return sorted(set(hits))


def _runtime_available() -> bool:
    return bool((os.environ.get("REPO_SCAN_TEST_BASE_URL") or "").strip())


def _test_user_available() -> bool:
    return bool((os.environ.get("REPO_SCAN_TEST_USER") or "").strip())


def _sandbox_available() -> bool:
    return (os.environ.get("REPO_SCAN_SANDBOX") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _workspace_available() -> bool:
    return bool((os.environ.get("REPO_SCAN_TEST_WORKSPACE") or "").strip())


def _can_run_generated() -> bool:
    return _runtime_available() and _sandbox_available()


def _spec_filename(feature_id: str, family: str) -> str:
    if family == "auth" or feature_id == "authentication":
        return "seethrough-auth.spec.ts"
    slug = re.sub(r"[^a-z0-9]+", "-", str(feature_id).lower()).strip("-")[:40]
    return f"seethrough-{slug or 'feature'}.spec.ts"


def _planned_from_specs(
    approved: list[dict[str, Any]], compiled: str
) -> list[dict[str, Any]]:
    planned: list[dict[str, Any]] = []
    for spec in approved:
        dumped = json.dumps(spec["name"])
        if f"test({dumped}" not in compiled:
            continue
        api = next(
            (
                item.get("resource")
                for item in spec.get("assertions") or []
                if item.get("type") == "protected_resource_denied"
            ),
            None,
        )
        planned.append(
            {
                "id": spec.get("id") or spec["name"],
                "name": spec["name"],
                "type": "browser",
                "assertion": spec.get("assertion") or spec["name"],
                "origin": spec.get("origin") or "template",
                "requires": ["running_app", "isolated_environment"],
                "api": api,
                "spec": {
                    "actions": spec.get("actions") or [],
                    "assertions": spec.get("assertions") or [],
                },
            }
        )
    return planned


def _with_signed_in_prefix(
    family: str,
    catalog: dict[str, Any],
    sources: dict[str, str],
    evidence: dict[str, Any],
    targets: dict[str, dict[str, str]],
    specs: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, dict[str, str]], list[dict[str, Any]]]:
    if family == "auth" or not _test_user_available():
        return evidence, targets, specs
    if not (os.environ.get("REPO_SCAN_TEST_PASSWORD") or "").strip():
        return evidence, targets, specs
    auth_feature = next(
        (
            item
            for item in catalog.get("features") or []
            if isinstance(item, dict) and detect_family(item, sources, {}) == "auth"
        ),
        None,
    )
    if not auth_feature:
        return evidence, targets, specs
    auth_evidence, auth_targets = infer_feature_evidence(
        auth_feature, catalog, sources, "auth"
    )
    login = str(auth_evidence.get("login_route") or "").strip()
    identity = (
        "email_input"
        if "email_input" in auth_targets
        else ("username_input" if "username_input" in auth_targets else None)
    )
    if (
        not login.startswith("/")
        or not identity
        or "password_input" not in auth_targets
        or "submit_button" not in auth_targets
    ):
        return evidence, targets, specs
    merged_targets = {**auth_targets, **targets}
    merged_evidence = dict(evidence)
    routes = [str(item) for item in (merged_evidence.get("routes") or []) if item]
    if login not in routes:
        routes.append(login)
    merged_evidence["routes"] = routes
    merged_evidence["login_route"] = login
    prefix = [
        {"type": "navigate", "path": login},
        {"type": "fill", "target": identity, "value": "env:REPO_SCAN_TEST_USER"},
        {"type": "fill", "target": "password_input", "value": "env:TEST_PASSWORD"},
        {"type": "click", "target": "submit_button"},
        {"type": "wait_load", "timeout_ms": 8000},
    ]
    gated: list[dict[str, Any]] = []
    for spec in specs:
        name = str(spec.get("name") or "").lower()
        if "anonymous" in name:
            gated.append(spec)
            continue
        actions = list(spec.get("actions") or [])
        first_nav = next(
            (
                str(item.get("path") or "")
                for item in actions
                if item.get("type") == "navigate"
            ),
            "",
        )
        if first_nav.rstrip("/") in {login.rstrip("/"), "/login", "/signin", "/sign-in"}:
            gated.append(spec)
            continue
        gated.append({**spec, "actions": prefix + actions})
    return merged_evidence, merged_targets, gated


def _generated_spec_runtime(
    feature: dict[str, Any],
    family: str,
    evidence: dict[str, Any],
    targets: dict[str, dict[str, str]],
    specs: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    approved, compiled = compile_feature_specs(
        specs,
        feature=feature,
        targets=targets,
        evidence=evidence,
        origin="template",
    )
    if not compiled or not approved:
        return None, []
    spec_name = _spec_filename(str(feature.get("feature_id") or "feature"), family)
    rel = f"tests/{spec_name}"
    origins = {str(item.get("origin") or "template") for item in approved}
    payload: dict[str, Any] = {
        "path": rel,
        "contents": compiled,
        "evidence": {
            "login_route": evidence.get("login_route"),
            "dashboard_route": evidence.get("dashboard_route"),
            "session_api": evidence.get("session_api"),
            "source_files": evidence.get("source_files") or [],
        },
        "specs": [
            {
                "name": item.get("name"),
                "origin": item.get("origin"),
                "actions": item.get("actions") or [],
                "assertions": item.get("assertions") or [],
            }
            for item in approved
        ],
        "ran": False,
        "origin": "mixed" if len(origins) > 1 else next(iter(origins)),
    }
    planned = _planned_from_specs(approved, compiled)
    requires = ["running_app", "isolated_environment"]
    if not _can_run_generated():
        results = [
            _result(
                {**item, "requires": requires},
                "blocked",
                f"Compiled {rel} from an approved test spec. Not run because no sandbox is set.",
                source=rel,
                suggested_fix="Start an isolated app and set REPO_SCAN_TEST_BASE_URL plus REPO_SCAN_SANDBOX=1.",
            )
            for item in planned
        ]
        return payload, results
    workdir = worker_workdir()
    base_url = (os.environ.get("REPO_SCAN_TEST_BASE_URL") or "").strip()
    if is_seethrough_base_url(base_url):
        results = [
            _result(
                {**item, "requires": requires},
                "blocked",
                "REPO_SCAN_TEST_BASE_URL is this SeeThrough server, not the scanned app.",
                source=rel,
                suggested_fix="Enter the running app URL on the scan page, then scan again.",
            )
            for item in planned
        ]
        return payload, results
    try:
        rel = write_playwright_project(
            workdir, compiled, base_url=base_url, spec_name=spec_name
        )
    except (OSError, ValueError) as error:
        return payload, [
            _result(
                {**item, "requires": requires},
                "blocked",
                f"Could not write the Playwright project: {error}.",
                source=rel,
            )
            for item in planned
        ]
    payload["path"] = rel
    report = run_playwright_test_sync(workdir, rel)
    payload["ran"] = report.get("status") == "ran"
    payload["run"] = {
        "status": report.get("status"),
        "reason": report.get("reason"),
    }
    by_title = {str(item.get("title")): item for item in report.get("specs") or []}

    def _match_spec(title: str) -> dict[str, Any] | None:
        if title in by_title:
            return by_title[title]
        for key, row in by_title.items():
            if title in key or key in title:
                return row
        return None

    sources_used = [str(item) for item in evidence.get("source_files") or []]
    results = []
    wrong_app = False
    for item in planned:
        normalized = normalize_result(
            feature_id=str(feature.get("feature_id") or family),
            test=item,
            spec_status=_match_spec(str(item.get("name"))),
            spec_path=rel,
            source_candidates=sources_used,
        )
        if report.get("status") != "ran" and not by_title:
            normalized["status"] = "blocked"
            normalized["summary"] = report.get("reason") or normalized["summary"]
        if (
            normalized.get("status") == "blocked"
            and "SeeThrough" in str(normalized.get("summary") or "")
            and "scanned app" in str(normalized.get("summary") or "")
        ):
            wrong_app = True
        results.append(
            {
                "id": item["id"],
                "name": item["name"],
                "type": "browser",
                "origin": item.get("origin") or "template",
                "assertion": item["assertion"],
                "status": normalized["status"],
                "explanation": normalized["summary"],
                "failing_step": normalized.get("failing_step"),
                "source": rel,
                "suggested_fix": normalized.get("suggested_fix"),
                "requires": requires,
                "evidence": normalized.get("evidence"),
                "source_candidates": sources_used,
            }
        )
    if wrong_app:
        message = (
            "Playwright opened REPO_SCAN_TEST_BASE_URL but that origin is not "
            "this repo's login UI. Point it at a running copy of the scanned app, "
            "not the SeeThrough server."
        )
        for row in results:
            if row.get("type") != "browser":
                continue
            row["status"] = "blocked"
            row["explanation"] = message
            row["failing_step"] = None
            row["suggested_fix"] = (
                "Start the scanned app and set REPO_SCAN_TEST_BASE_URL to that origin."
            )
    return payload, results


def plan_tests(
    feature: dict[str, Any],
    catalog: dict[str, Any] | None = None,
    files: list[dict[str, Any]] | None = None,
    sources: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Deterministic candidates from the feature family and verified files."""
    file_map = _file_map(files)
    source_map = {
        _clean(key): value for key, value in (sources or {}).items() if value
    }
    family = detect_family(feature, source_map, file_map)
    catalog = catalog if isinstance(catalog, dict) else {}
    tests: list[dict[str, Any]] = []
    fid = str(feature.get("feature_id") or "feature")

    if family == "auth":
        if _has_route(feature, "login", "signin", "sign-in"):
            tests.append(
                {
                    "id": f"{fid}-s01",
                    "name": "Login entry exists",
                    "type": "static",
                    "origin": "template",
                    "assertion": "A login page or login form is present in source",
                    "requires": [],
                    "family": family,
                }
            )
        tests.append(
            {
                "id": f"{fid}-s02",
                "name": "Auth service exists",
                "type": "static",
                "origin": "template",
                "assertion": "Source defines a sign-in or sign-up function",
                "requires": [],
                "family": family,
            }
        )
        private = _private_route_evidence(feature, catalog)
        tests.append(
            {
                "id": f"{fid}-003",
                "name": "Private route access protected",
                "type": "static",
                "origin": "template",
                "assertion": "Anonymous visitors are redirected on routes that look private",
                "requires": [],
                "family": family,
                "intended_routes": private,
                "uncertain_without_routes": True,
            }
        )
        if _has_route(feature, "signup", "register", "sign-up"):
            tests.append(
                {
                    "id": f"{fid}-s03",
                    "name": "Signup entry exists",
                    "type": "static",
                    "origin": "template",
                    "assertion": "A signup page is present in source",
                    "requires": [],
                    "family": family,
                }
            )
    elif family == "payments":
        tests.extend(
            [
                {
                    "id": f"{fid}-s01",
                    "name": "Checkout entry exists",
                    "type": "static",
                    "origin": "template",
                    "assertion": "A checkout page or payment service is present",
                    "requires": [],
                    "family": family,
                },
                {
                    "id": f"{fid}-002",
                    "name": "Duplicate webhook handling",
                    "type": "static",
                    "origin": "template",
                    "assertion": "Webhook handler exists if the feature claims payment events",
                    "requires": [],
                    "family": family,
                    "uncertain_without_routes": True,
                },
            ]
        )
    elif family == "dashboard":
        tests.append(
            {
                "id": f"{fid}-s01",
                "name": "Dashboard page exists",
                "type": "static",
                "origin": "template",
                "assertion": "A dashboard or list page is present",
                "requires": [],
                "family": family,
            }
        )
    elif family == "crud":
        tests.append(
            {
                "id": f"{fid}-s01",
                "name": "Dashboard page exists",
                "type": "static",
                "origin": "template",
                "assertion": "A dashboard or list page is present",
                "requires": [],
                "family": family,
            }
        )
        tests.append(
            {
                "id": f"{fid}-s02",
                "name": "Mutations found in source",
                "type": "static",
                "origin": "template",
                "assertion": "Create/edit/delete helpers exist. Persistence is unproven.",
                "requires": [],
                "family": family,
            }
        )
    elif family == "search":
        tests.append(
            {
                "id": f"{fid}-s01",
                "name": "Search entry exists",
                "type": "static",
                "origin": "template",
                "assertion": "Search UI or query helper is present",
                "requires": [],
                "family": family,
            }
        )
    elif family == "upload":
        tests.append(
            {
                "id": f"{fid}-s01",
                "name": "Upload input exists",
                "type": "static",
                "origin": "template",
                "assertion": "A file input or upload handler is present",
                "requires": [],
                "family": family,
            }
        )
    elif family == "settings":
        tests.append(
            {
                "id": f"{fid}-s01",
                "name": "Settings page exists",
                "type": "static",
                "origin": "template",
                "assertion": "A settings page or save handler is present",
                "requires": [],
                "family": family,
            }
        )
    elif family == "chatbot":
        tests.append(
            {
                "id": f"{fid}-s01",
                "name": "Chat surface exists",
                "type": "static",
                "origin": "template",
                "assertion": "A chat page or message composer is present",
                "requires": [],
                "family": family,
            }
        )
    else:
        tests.append(
            {
                "id": f"{fid}-s01",
                "name": "Feature entry exists",
                "type": "static",
                "origin": "template",
                "assertion": "The feature has at least one page or service file",
                "requires": [],
                "family": family,
            }
        )
    return tests


def _llm_planner_enabled() -> bool:
    return (os.environ.get("REPO_SCAN_TEST_PLANNER_LLM") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def propose_llm_tests(feature: dict[str, Any]) -> list[dict[str, Any]]:
    """Optional extra claims. Off unless REPO_SCAN_TEST_PLANNER_LLM is set."""
    if not _llm_planner_enabled():
        return []
    try:
        from llm_client import LlmClient, has_llm_config
    except Exception:
        return []
    if not has_llm_config():
        return []
    prompt = (
        "Propose extra tests for this software feature. Return JSON "
        '{"tests":[{"name":"string","type":"static|integration|browser",'
        '"assertion":"string","requires":[]}]}. '
        "These are candidates, not requirements. Do not assume every route "
        "must be protected.\n"
        f"name={feature.get('name')}\n"
        f"entries={feature.get('entry_points')}\n"
        f"files={feature.get('primary_files')}\n"
    )
    try:
        raw = LlmClient(timeout=12).generate(prompt, response_format="json")
        data = json.loads(raw)
    except Exception:
        return []
    tests = data.get("tests") if isinstance(data, dict) else None
    if not isinstance(tests, list):
        return []
    return [item for item in tests if isinstance(item, dict)][:6]


def _missing_requires(requires: list[str]) -> list[str]:
    missing: list[str] = []
    for item in requires:
        if item == "running_app" and not _runtime_available():
            missing.append(item)
        if item == "isolated_environment" and not _sandbox_available():
            missing.append(item)
        if item in {"test_user", "test_database"} and not _test_user_available():
            missing.append(item)
        if item == "workspace" and not _workspace_available():
            missing.append(item)
    return missing


def _blocked(test: dict[str, Any], missing: list[str]) -> dict[str, Any]:
    return {
        "id": test["id"],
        "name": test["name"],
        "type": test["type"],
        "assertion": test["assertion"],
        "status": "blocked",
        "explanation": (
            "This test needs a sandbox or credentials that are not available: "
            + ", ".join(missing)
            + "."
        ),
        "failing_step": None,
        "source": None,
        "suggested_fix": (
            "Provide an isolated app URL and test user before running "
            f"{test['type']} checks."
        ),
        "requires": test.get("requires") or [],
        "origin": test.get("origin"),
    }


def _result(
    test: dict[str, Any],
    status: str,
    explanation: str,
    *,
    source: str | None = None,
    failing_step: str | None = None,
    suggested_fix: str | None = None,
) -> dict[str, Any]:
    return {
        "id": test["id"],
        "name": test["name"],
        "type": test["type"],
        "assertion": test["assertion"],
        "status": status,
        "explanation": explanation,
        "failing_step": failing_step,
        "source": source,
        "suggested_fix": suggested_fix,
        "requires": test.get("requires") or [],
        "origin": test.get("origin") or ("template" if test.get("type") == "static" else None),
    }


def run_static_test(
    test: dict[str, Any],
    feature: dict[str, Any],
    file_map: dict[str, dict[str, Any]],
    sources: dict[str, str],
    catalog: dict[str, Any],
) -> dict[str, Any]:
    paths = [_clean(path) for path in feature.get("primary_files") or []]
    source = _joined_source(paths, sources)
    symbols = _symbols(paths, file_map)
    name = test["name"]

    if name == "Login entry exists":
        page = next((path for path in paths if "login" in path.lower()), None)
        formish = bool(FORM_HINTS.search(source)) or any(
            "login" in item.lower() or "signin" in item.lower() for item in symbols
        )
        if page or formish:
            return _result(
                test,
                "pass",
                "A login page or form component is in the feature files.",
                source=page or (paths[0] if paths else None),
            )
        return _result(
            test,
            "fail",
            "No login page or form was found in the feature files.",
            failing_step="Look for app/login/page.tsx or a LoginForm.",
            suggested_fix="Add a login route and a form that calls the auth service.",
        )

    if name == "Auth service exists":
        extra_paths = paths + [
            _clean(path) for path in feature.get("shared_dependencies") or []
        ]
        extra_source = _joined_source(extra_paths, sources)
        extra_symbols = _symbols(extra_paths, file_map)
        hit = next(
            (
                item
                for item in extra_symbols
                if re.search(
                    r"signIn|signUp|logIn|useAuth|AuthContext|authenticate|verifySession",
                    item,
                )
            ),
            None,
        )
        auth_file = next(
            (
                path
                for path in extra_paths
                if re.search(
                    r"(^|/)(auth|session|useauth|authcontext)\.[tj]sx?$",
                    path,
                    re.I,
                )
            ),
            None,
        ) or next(
            (
                path
                for path in extra_paths
                if re.search(r"authcontext|useauth|lib/auth", path, re.I)
            ),
            None,
        )
        if hit or re.search(
            r"function signIn|function signUp|function logIn|export function useAuth|"
            r"AuthContext|createContext\([^\)]*auth|signInWith",
            extra_source,
            re.I,
        ):
            return _result(
                test,
                "pass",
                f"Found {hit or 'an auth helper'} in the authentication files.",
                source=auth_file,
            )
        return _result(
            test,
            "fail",
            "No sign-in, sign-up, or auth context was found.",
            failing_step="Inspect AuthContext or lib/auth.ts for a sign-in helper.",
            source=auth_file or next(
                (path for path in extra_paths if re.search(r"auth", path, re.I)),
                None,
            ),
            suggested_fix="Export a sign-in helper and call it from the login form.",
        )

    if name == "Signup entry exists":
        page = next(
            (path for path in paths if re.search(r"signup|register|sign-up", path, re.I)),
            None,
        )
        if page or _has_route(feature, "signup", "register", "sign-up"):
            return _result(
                test,
                "pass",
                "A signup route or page is present.",
                source=page,
            )
        return _result(
            test,
            "fail",
            "Signup was grouped with this feature but no signup page was found.",
            failing_step="Look for app/signup/page.tsx.",
            suggested_fix="Add a signup route or drop it from the feature entries.",
        )

    if name == "Private route access protected":
        intended = [str(item) for item in test.get("intended_routes") or []]
        if not intended:
            return _result(
                test,
                "inconclusive",
                "Discovering authentication does not prove every route should be protected. No private-route metadata was found.",
                suggested_fix="Mark dashboards or settings as protected in middleware or a ProtectedRoute wrapper.",
            )
        all_paths = list(file_map)
        protect_files = [
            path
            for path in all_paths
            if re.search(r"middleware|protectedroute|auth-guard|guard", path, re.I)
            or PROTECTION_HINTS.search(sources.get(path) or "")
        ]
        if protect_files:
            return _result(
                test,
                "pass",
                f"Protection helpers exist for private-looking routes: {', '.join(intended)}.",
                source=protect_files[0],
            )
        return _result(
            test,
            "inconclusive",
            (
                f"Routes {', '.join(intended)} look private, but no middleware or "
                "ProtectedRoute was found. Intended protection is uncertain."
            ),
            failing_step="No auth guard matched those routes.",
            suggested_fix="Add middleware or a protected layout around private pages.",
        )

    if name == "Checkout entry exists":
        page = next(
            (path for path in paths if re.search(r"checkout|pay|billing", path, re.I)),
            None,
        )
        pay_fn = next(
            (item for item in symbols if re.search(r"charge|checkout|stripe|pay", item, re.I)),
            None,
        )
        if page or pay_fn:
            return _result(
                test,
                "pass",
                "Checkout UI or a payment function is present.",
                source=page or next((path for path in paths if "stripe" in path), None),
            )
        return _result(
            test,
            "fail",
            "No checkout page or payment helper was found.",
            suggested_fix="Add a checkout route or a charge function.",
        )

    if name == "Duplicate webhook handling":
        webhook_files = [
            path
            for path, row in file_map.items()
            if "webhook" in path.lower() or WEBHOOK_HINTS.search(sources.get(path) or "")
        ]
        if webhook_files:
            return _result(
                test,
                "pass",
                "A webhook handler is present. Duplicate delivery is still unproven.",
                source=webhook_files[0],
            )
        return _result(
            test,
            "inconclusive",
            "No webhook handler was found, so duplicate payment events cannot be judged.",
            suggested_fix="Add a webhook route before claiming payment confirmation.",
        )

    if name in {
        "Dashboard page exists",
        "Search entry exists",
        "Upload input exists",
        "Settings page exists",
        "Chat surface exists",
        "Feature entry exists",
        "Mutations found in source",
    }:
        if name == "Mutations found in source":
            return _result(
                test,
                "inconclusive",
                "Source has create/edit/delete helpers. No generated Playwright spec exists yet to prove they persist.",
                source=paths[0] if paths else None,
            )
        if paths:
            return _result(
                test,
                "pass",
                "The feature has primary files that can be used as an entry.",
                source=paths[0],
            )
        return _result(
            test,
            "fail",
            "This feature has no primary files.",
            suggested_fix="Re-run discovery; a feature without files cannot be tested.",
        )

    return _result(test, "inconclusive", "No static checker is registered for this claim.")


def invoke_runtime(test: dict[str, Any], feature: dict[str, Any]) -> dict[str, Any]:
    """Playwright or Vitest, only when a sandbox URL or workspace is provided."""
    if not os.path.isfile(_RUNTIME_SCRIPT):
        return _blocked(test, ["runtime_runner"])
    payload = {
        "test": {
            "id": test.get("id"),
            "name": test.get("name"),
            "type": test.get("type"),
            "assertion": test.get("assertion"),
            "requires": test.get("requires") or [],
            "intended_routes": test.get("intended_routes") or [],
        },
        "feature": {
            "feature_id": feature.get("feature_id"),
            "name": feature.get("name"),
            "entry_points": feature.get("entry_points") or [],
            "primary_files": feature.get("primary_files") or [],
        },
        "baseUrl": (os.environ.get("REPO_SCAN_TEST_BASE_URL") or "").strip(),
        "workspace": (os.environ.get("REPO_SCAN_TEST_WORKSPACE") or "").strip(),
        "sandbox": _sandbox_available(),
        "testUser": (os.environ.get("REPO_SCAN_TEST_USER") or "").strip(),
    }
    try:
        proc = subprocess.run(
            ["node", _RUNTIME_SCRIPT],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=45,
            cwd=_REPO_ROOT,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return _result(
            test,
            "blocked",
            f"The {test.get('type')} runner could not start: {error}.",
            suggested_fix="Install Playwright browsers or Vitest in the sandbox.",
        )
    raw = (proc.stdout or "").strip()
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        parsed = {}
    if not isinstance(parsed, dict) or parsed.get("status") not in STATUSES:
        return _result(
            test,
            "blocked",
            "The runtime runner returned no usable result.",
            suggested_fix="Check Playwright/Vitest install in the sandbox.",
        )
    return _result(
        test,
        str(parsed["status"]),
        str(parsed.get("explanation") or "Runtime finished."),
        source=parsed.get("source"),
        failing_step=parsed.get("failing_step"),
        suggested_fix=parsed.get("suggested_fix"),
    )


def run_test(
    test: dict[str, Any],
    feature: dict[str, Any],
    file_map: dict[str, dict[str, Any]],
    sources: dict[str, str],
    catalog: dict[str, Any],
) -> dict[str, Any]:
    missing = _missing_requires([str(item) for item in test.get("requires") or []])
    if test.get("type") in {"browser", "integration"}:
        if missing:
            return _blocked(test, missing)
        return invoke_runtime(test, feature)
    if test.get("type") == "static":
        return run_static_test(test, feature, file_map, sources, catalog)
    return _result(test, "inconclusive", "Unknown test type.")


def rollup_status(results: list[dict[str, Any]]) -> str:
    if not results:
        return "not_tested"
    statuses = [str(item.get("status") or "") for item in results]
    if "fail" in statuses:
        return "failed"
    if all(status == "pass" for status in statuses):
        if all(str(item.get("type") or "") == "static" for item in results):
            return "inconclusive"
        return "passed"
    if all(status == "blocked" for status in statuses):
        return "blocked"
    return "inconclusive"


def _summary(results: list[dict[str, Any]], status: str) -> dict[str, Any]:
    failed = next((item for item in results if item.get("status") == "fail"), None)
    blocked = [item for item in results if item.get("status") == "blocked"]
    if failed:
        return {
            "summary": failed.get("explanation") or "A static check failed.",
            "failing_step": failed.get("failing_step") or failed.get("name"),
            "source": failed.get("source"),
            "suggested_fix": failed.get("suggested_fix"),
        }
    if status == "passed":
        return {
            "summary": "Static checks passed. Runtime behavior is still unproven.",
            "failing_step": None,
            "source": None,
            "suggested_fix": None,
        }
    if status == "inconclusive" and results and all(
        str(item.get("type") or "") == "static" and item.get("status") == "pass"
        for item in results
    ):
        return {
            "summary": "The page exists in source. That does not prove the feature works at runtime.",
            "failing_step": None,
            "source": None,
            "suggested_fix": None,
        }
    if status == "blocked" or (blocked and status == "inconclusive"):
        reason = next(
            (
                item
                for item in blocked
                if "scanned app" in str(item.get("explanation") or "")
                or "SeeThrough" in str(item.get("explanation") or "")
            ),
            blocked[0] if blocked else None,
        )
        if reason and reason.get("explanation"):
            return {
                "summary": reason["explanation"],
                "failing_step": None,
                "source": reason.get("source"),
                "suggested_fix": reason.get("suggested_fix")
                or (
                    "Start the scanned app and set REPO_SCAN_TEST_BASE_URL to that origin."
                    if "scanned app" in str(reason.get("explanation") or "")
                    or "SeeThrough" in str(reason.get("explanation") or "")
                    else "Inspect the Playwright trace for a hanging login request."
                ),
            }
        return {
            "summary": "Some checks passed in source. Browser and API tests need a sandbox.",
            "failing_step": None,
            "source": None,
            "suggested_fix": "Run Playwright against an isolated app to prove sessions and payments.",
        }
    return {
        "summary": "The intended behavior is not fully proven from source alone.",
        "failing_step": None,
        "source": None,
        "suggested_fix": None,
    }


def verify_feature(
    feature: dict[str, Any],
    catalog: dict[str, Any],
    files: list[dict[str, Any]] | None = None,
    sources: dict[str, str] | None = None,
    repo_artifacts: dict[str, Any] | None = None,
    llm_budget: dict[str, int] | None = None,
) -> dict[str, Any]:
    if not isinstance(feature, dict) or not feature.get("feature_id"):
        return {
            "feature_id": None,
            "family": "unknown",
            "verification_status": "not_tested",
            "tests": [],
            "generated_test": None,
        }
    file_map = _file_map(files)
    source_map = {
        _clean(key): value for key, value in (sources or {}).items() if value
    }
    family = detect_family(feature, source_map, file_map)
    tests = plan_tests(feature, catalog, files, sources)
    evidence, targets = infer_feature_evidence(feature, catalog, source_map, family)
    planned_specs = template_specs(family, feature, evidence, targets)
    if llm_budget is not None and int(llm_budget.get("left") or 0) > 0:
        extra = propose_restricted_specs(
            feature, targets=targets, evidence=evidence, family=family
        )
        seen = {str(item.get("name") or "") for item in planned_specs}
        added = [item for item in extra if item.get("name") and item["name"] not in seen]
        if added:
            planned_specs.extend(added)
            llm_budget["left"] = int(llm_budget.get("left") or 0) - 1
    evidence, targets, planned_specs = _with_signed_in_prefix(
        family, catalog, source_map, evidence, targets, planned_specs
    )
    generated, generated_runtime = _generated_spec_runtime(
        feature, family, evidence, targets, planned_specs
    )
    results: list[dict[str, Any]] = []
    for item in tests:
        if item.get("type") in {"browser", "integration"}:
            continue
        results.append(run_test(item, feature, file_map, source_map, catalog))
    results.extend(generated_runtime)
    results.extend(run_feature_repo_tests(feature, repo_artifacts or {}))
    status = rollup_status(results)
    extra = _summary(results, status)
    return {
        "feature_id": feature.get("feature_id"),
        "family": family,
        "verification_status": status,
        "tests": results,
        "generated_test": generated,
        **extra,
    }


def verify_catalog(
    catalog: dict[str, Any] | None,
    files: list[dict[str, Any]] | None = None,
    sources: dict[str, str] | None = None,
) -> dict[str, Any]:
    if not isinstance(catalog, dict):
        return {
            "features": [],
            "infrastructure": [],
            "graph": {"nodes": [], "edges": []},
            "file_index": {},
            "repo_checks": [],
        }
    updated = dict(catalog)
    artifacts = index_repo_artifacts(files, sources)
    llm_budget = {"left": 8}
    features: list[dict[str, Any]] = []
    for feature in catalog.get("features") or []:
        if not isinstance(feature, dict):
            continue
        result = verify_feature(
            feature,
            catalog,
            files,
            sources,
            repo_artifacts=artifacts,
            llm_budget=llm_budget,
        )
        record = dict(feature)
        record["verification_status"] = result["verification_status"]
        record["verification"] = result
        features.append(record)
    updated["features"] = features
    updated["repo_checks"] = catalog_repo_checks(artifacts)
    return updated


def self_test() -> int:
    for key in (
        "REPO_SCAN_TEST_BASE_URL",
        "REPO_SCAN_TEST_USER",
        "REPO_SCAN_SANDBOX",
        "REPO_SCAN_TEST_WORKSPACE",
        "REPO_SCAN_TEST_PLANNER_LLM",
        "REPO_SCAN_TEST_SPEC_CACHE",
    ):
        os.environ.pop(key, None)
    os.environ["REPO_SCAN_TEST_PLANNER_LLM"] = "0"
    empty = verify_catalog({"features": [], "graph": {"nodes": [], "edges": []}, "file_index": {}})
    if empty["features"] != []:
        print("empty catalog should stay empty", file=sys.stderr)
        return 2
    invalid = verify_feature({}, {}, [], {})
    if invalid["verification_status"] != "not_tested":
        print("invalid feature should stay not_tested", file=sys.stderr)
        return 2

    catalog = {
        "features": [
            {
                "feature_id": "authentication",
                "name": "User Authentication",
                "entry_points": ["/login", "/signup"],
                "primary_files": [
                    "app/login/page.tsx",
                    "app/signup/page.tsx",
                    "lib/auth.ts",
                ],
                "related_features": ["dashboard"],
            },
            {
                "feature_id": "dashboard",
                "name": "Dashboard",
                "entry_points": ["/dashboard"],
                "primary_files": ["app/dashboard/page.tsx"],
                "related_features": ["authentication"],
            },
        ]
    }
    files = [
        {
            "path": "app/login/page.tsx",
            "symbols": [{"name": "LoginPage"}],
            "jsx": ["LoginForm"],
        },
        {
            "path": "lib/auth.ts",
            "symbols": [{"name": "signIn"}, {"name": "signUp"}],
        },
        {"path": "app/signup/page.tsx", "symbols": [{"name": "SignupPage"}]},
        {"path": "app/dashboard/page.tsx", "symbols": [{"name": "DashboardPage"}]},
    ]
    sources = {
        "app/login/page.tsx": "export default function LoginPage() { return <LoginForm />; }\n",
        "lib/auth.ts": "export function signIn() { return true; }\nexport function signUp() { return true; }\n",
        "app/signup/page.tsx": "export default function SignupPage() { return <form />; }\n",
        "app/dashboard/page.tsx": "export default function DashboardPage() { return <div />; }\n",
    }
    verified = verify_catalog(catalog, files, sources)
    auth = verified["features"][0]
    if detect_family(auth) != "auth":
        print("login/signup should be the auth family", file=sys.stderr)
        return 2
    by_name = {item["name"]: item for item in auth["verification"]["tests"]}
    if by_name["Login entry exists"]["status"] != "pass":
        print("login entry static test should pass", file=sys.stderr)
        return 2
    if by_name["Auth service exists"]["status"] != "pass":
        print("signIn should satisfy the auth service check", file=sys.stderr)
        return 2
    generated = auth["verification"].get("generated_test") or {}
    if "seethrough-auth.spec.ts" not in str(generated.get("path") or ""):
        print("auth should generate an executable Playwright spec", file=sys.stderr)
        return 2
    if "invalid@example.test" in str(generated.get("contents") or ""):
        print("must not invent credential fills without email/password fields", file=sys.stderr)
        return 2
    if by_name["Login page renders"]["status"] != "blocked":
        print("generated Playwright tests should stay blocked without a sandbox", file=sys.stderr)
        return 2
    protection = by_name["Private route access protected"]
    if protection["status"] != "inconclusive":
        print(
            f"protection without middleware should be inconclusive, got {protection['status']}",
            file=sys.stderr,
        )
        return 2
    if auth["verification_status"] != "inconclusive":
        print("mixed pass/blocked/inconclusive should roll up to inconclusive", file=sys.stderr)
        return 2
    if "sandbox" not in str(auth["verification"].get("summary") or "").lower():
        print("blocked browser tests should explain the sandbox gap", file=sys.stderr)
        return 2

    dashboard = verified["features"][1]
    dash_names = [item["name"] for item in dashboard["verification"]["tests"]]
    if "Create retrieve edit delete" in dash_names:
        print("a read-only dashboard must not get a CRUD browser test", file=sys.stderr)
        return 2
    if dashboard["verification"]["family"] != "dashboard":
        print("read-only dashboard should stay in the dashboard family", file=sys.stderr)
        return 2
    dash_generated = dashboard["verification"].get("generated_test") or {}
    if "seethrough-dashboard.spec.ts" not in str(dash_generated.get("path") or ""):
        print("dashboard should compile a restricted Playwright spec", file=sys.stderr)
        return 2
    if "Feature route loads" not in dash_names:
        print("dashboard template should include a route-load browser spec", file=sys.stderr)
        return 2

    orders = verify_feature(
        {
            "feature_id": "orders",
            "name": "Orders",
            "entry_points": ["/orders"],
            "primary_files": ["app/orders/page.tsx"],
        },
        {"features": []},
        [{"path": "app/orders/page.tsx", "symbols": [{"name": "createOrder"}]}],
        {
            "app/orders/page.tsx": (
                "export async function createOrder() { return true; }\n"
                "export default function OrdersPage() { return <form />; }\n"
            )
        },
    )
    if orders["family"] != "crud":
        print(f"orders with createOrder should be crud, got {orders['family']}", file=sys.stderr)
        return 2
    if any(item["name"] == "Create retrieve edit delete" for item in orders["tests"]):
        print("must not keep an unrunnable CRUD browser test on the card", file=sys.stderr)
        return 2
    mutation = next(
        (item for item in orders["tests"] if item["name"] == "Mutations found in source"),
        None,
    )
    if not mutation or mutation["status"] != "inconclusive":
        print("CRUD evidence should stay inconclusive until a spec exists", file=sys.stderr)
        return 2
    if not any(item["name"] == "Feature form loads" for item in orders["tests"]):
        print("CRUD template should compile a form-load spec", file=sys.stderr)
        return 2
    os.environ["REPO_SCAN_TEST_USER"] = "trader@example.test"
    os.environ["REPO_SCAN_TEST_PASSWORD"] = "secret"
    _gated_e, _gated_t, gated_specs = _with_signed_in_prefix(
        "crud",
        {
            "features": [
                {
                    "feature_id": "authentication",
                    "name": "Authentication",
                    "entry_points": ["/login"],
                    "primary_files": ["app/login/page.tsx"],
                }
            ]
        },
        {
            "app/login/page.tsx": (
                '<form><input type="email" /><input type="password" />'
                "<button>Sign in</button></form>"
            )
        },
        {"primary_route": "/orders", "routes": ["/orders"]},
        {"create_button": {"kind": "role", "role": "button", "name": "Create"}},
        [
            {
                "name": "Feature form loads",
                "actions": [{"type": "navigate", "path": "/orders"}],
                "assertions": [{"type": "page_loaded"}],
            }
        ],
    )
    os.environ.pop("REPO_SCAN_TEST_USER", None)
    os.environ.pop("REPO_SCAN_TEST_PASSWORD", None)
    if not gated_specs or gated_specs[0]["actions"][0].get("path") != "/login":
        print("signed-in tests should log in before the feature route", file=sys.stderr)
        return 2

    docs = verify_feature(
        {
            "feature_id": "documentation",
            "name": "Documentation",
            "entry_points": ["/docs"],
            "primary_files": ["app/docs/page.tsx"],
        },
        {"features": []},
        [{"path": "app/docs/page.tsx", "symbols": [{"name": "DocsPage"}]}],
        {"app/docs/page.tsx": "export default function DocsPage() { rows.update(); return <div />; }\n"},
    )
    if any(item["name"] == "Create retrieve edit delete" for item in docs["tests"]):
        print("a .update() call must not become a CRUD browser test", file=sys.stderr)
        return 2

    context_auth = verify_feature(
        {
            "feature_id": "authentication",
            "name": "User Authentication",
            "entry_points": ["/login"],
            "primary_files": ["web/src/features/auth/LoginPage.tsx"],
            "shared_dependencies": ["web/src/shared/lib/AuthContext.tsx"],
        },
        {"features": []},
        [
            {"path": "web/src/features/auth/LoginPage.tsx", "symbols": [{"name": "LoginPage"}]},
            {
                "path": "web/src/shared/lib/AuthContext.tsx",
                "symbols": [{"name": "useAuth"}, {"name": "AuthProvider"}],
            },
        ],
        {
            "web/src/features/auth/LoginPage.tsx": (
                "export default function LoginPage() { return <form />; }\n"
            ),
            "web/src/shared/lib/AuthContext.tsx": (
                "export function useAuth() { return { signIn() {} }; }\n"
            ),
        },
    )
    context_tests = {item["name"]: item for item in context_auth["tests"]}
    if context_tests["Auth service exists"]["status"] != "pass":
        print("AuthContext/useAuth should satisfy the auth service check", file=sys.stderr)
        return 2

    plan = plan_tests(catalog["features"][0], catalog)
    if any(item["name"] == "Duplicate webhook handling" for item in plan):
        print("auth should not receive payment webhook tests", file=sys.stderr)
        return 2

    payments = verify_feature(
        {
            "feature_id": "payments",
            "name": "Payments",
            "entry_points": ["/checkout"],
            "primary_files": ["app/checkout/page.tsx", "lib/stripe.ts"],
        },
        {"features": []},
        [
            {"path": "app/checkout/page.tsx", "symbols": [{"name": "CheckoutPage"}]},
            {"path": "lib/stripe.ts", "symbols": [{"name": "charge"}]},
        ],
        {
            "app/checkout/page.tsx": "export default function CheckoutPage() { return <form />; }\n",
            "lib/stripe.ts": "export function charge() { return true; }\n",
        },
    )
    pay_tests = {item["name"]: item for item in payments["tests"]}
    if pay_tests["Checkout entry exists"]["status"] != "pass":
        print("checkout static test should pass", file=sys.stderr)
        return 2
    if pay_tests["Duplicate webhook handling"]["status"] != "inconclusive":
        print("missing webhook should be inconclusive, not fail", file=sys.stderr)
        return 2

    missing_login = verify_feature(
        {
            "feature_id": "authentication",
            "name": "User Authentication",
            "entry_points": ["/login"],
            "primary_files": [],
        },
        {"features": []},
        [],
        {},
    )
    missing_tests = {item["name"]: item for item in missing_login["tests"]}
    if missing_tests["Login entry exists"]["status"] != "fail":
        print("auth without files should fail the login entry check", file=sys.stderr)
        return 2
    if missing_login["verification_status"] != "failed":
        print("a failing static check should roll up to failed", file=sys.stderr)
        return 2
    if propose_llm_tests(catalog["features"][0]) != []:
        print("LLM proposals should stay off unless explicitly enabled", file=sys.stderr)
        return 2

    print(json.dumps({"ok": True, "selfTest": True, "status": auth["verification_status"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
