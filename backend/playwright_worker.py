"""Run generated SeeThrough Playwright specs in an isolated worker dir.

This is a worker-side prototype, not a secure sandbox. Timeouts do not
make third-party repositories safe. The worker must only execute
allowlisted generated files and must not run the scanned repo's install
or build scripts.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from typing import Any
from urllib.parse import urlparse

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_BACKEND_DIR)
ALLOWED_TEST = re.compile(r"^tests/seethrough-[a-z0-9-]+\.spec\.ts$")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
MISSING_UI = re.compile(
    r"element\(s\) not found|locator\('input\[type=\\?\"email\"|waiting for locator",
    re.I,
)


def strip_ansi(text: Any) -> str:
    return ANSI.sub("", str(text or "")).replace("\n", " ").strip()


def is_seethrough_base_url(base_url: str | None = None) -> bool:
    """True when REPO_SCAN_TEST_BASE_URL is this Next app, usually :3000."""
    raw = (base_url or os.environ.get("REPO_SCAN_TEST_BASE_URL") or "").strip()
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if host not in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return False
    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme == "https" else 80
    return port == 3000


def _wrong_app_message() -> dict[str, str]:
    return {
        "summary": (
            "Playwright opened REPO_SCAN_TEST_BASE_URL but that origin is this "
            "SeeThrough server, not a running copy of the scanned app."
        ),
        "suggested_fix": (
            "Enter the running app URL on the scan page, then scan again."
        ),
    }


def _login_wall_message() -> dict[str, str]:
    return {
        "summary": (
            "This feature sent the browser to login, so the page was never opened."
        ),
        "suggested_fix": "Enter a test login on the scan page, then scan again.",
    }


PLAYWRIGHT_CLI = os.path.join(
    _REPO_ROOT, "node_modules", "@playwright", "test", "cli.js"
)
TIMEOUT_SEC = 120


def worker_workdir(explicit: str | None = None) -> str:
    workspace = (explicit or os.environ.get("REPO_SCAN_TEST_WORKSPACE") or "").strip()
    root = workspace or _REPO_ROOT
    return os.path.join(root, ".seethrough", "playwright")


def allowed_test_file(workdir: str, test_file: str) -> str | None:
    if not workdir or not test_file:
        return None
    rel = str(test_file).replace("\\", "/").lstrip("/")
    if not ALLOWED_TEST.fullmatch(rel):
        return None
    root = os.path.realpath(workdir)
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(root + os.sep):
        return None
    if not os.path.isfile(full):
        return None
    return rel


def write_playwright_project(
    workdir: str,
    spec_contents: str,
    *,
    base_url: str,
    spec_name: str = "seethrough-auth.spec.ts",
) -> str:
    if not ALLOWED_TEST.fullmatch(f"tests/{spec_name}"):
        raise ValueError("Generated spec name is not allowlisted.")
    tests_dir = os.path.join(workdir, "tests")
    artifacts = os.path.join(workdir, "artifacts")
    os.makedirs(tests_dir, exist_ok=True)
    os.makedirs(artifacts, exist_ok=True)
    spec_rel = f"tests/{spec_name}"
    with open(os.path.join(workdir, spec_rel), "w", encoding="utf-8") as handle:
        handle.write(spec_contents)
    api_url = (os.environ.get("REPO_SCAN_TEST_API_URL") or "").strip().rstrip("/")
    config = (
        'const { defineConfig } = require("@playwright/test");\n'
        "module.exports = defineConfig({\n"
        '  testDir: "./tests",\n'
        "  timeout: 30_000,\n"
        '  outputDir: "./artifacts",\n'
        "  use: {\n"
        f"    baseURL: {json.dumps(base_url.rstrip('/'))},\n"
        '    trace: "retain-on-failure",\n'
        "  },\n"
        f"  metadata: {{ apiUrl: {json.dumps(api_url)} }},\n"
        "});\n"
    )
    with open(os.path.join(workdir, "playwright.config.js"), "w", encoding="utf-8") as handle:
        handle.write(config)
    return spec_rel


def _walk_specs(node: Any, acc: list[dict[str, Any]]) -> None:
    if isinstance(node, list):
        for item in node:
            _walk_specs(item, acc)
        return
    if not isinstance(node, dict):
        return
    for spec in node.get("specs") or []:
        if not isinstance(spec, dict):
            continue
        results = []
        for test in spec.get("tests") or []:
            results.extend(test.get("results") or [])
        last = results[-1] if results else {}
        attachments = last.get("attachments") if isinstance(last, dict) else []
        trace = None
        for item in attachments or []:
            if isinstance(item, dict) and "trace" in str(item.get("name") or "").lower():
                trace = item.get("path")
        error = last.get("error") if isinstance(last, dict) else None
        status = str((last or {}).get("status") or "")
        if spec.get("ok") is True:
            mapped = "pass"
        elif status in {"timedOut", "interrupted"}:
            mapped = "blocked"
        elif spec.get("ok") is False or status in {"failed", "unexpected"}:
            mapped = "fail"
        else:
            mapped = "inconclusive"
        acc.append(
            {
                "title": spec.get("title") or spec.get("file"),
                "status": mapped,
                "error": (error or {}).get("message") if isinstance(error, dict) else None,
                "trace_path": trace,
            }
        )
    _walk_specs(node.get("suites") or [], acc)


def parse_playwright_json(raw: str) -> list[dict[str, Any]]:
    try:
        report = json.loads(raw or "")
    except json.JSONDecodeError:
        return []
    if not isinstance(report, dict):
        return []
    specs: list[dict[str, Any]] = []
    _walk_specs(report.get("suites") or report, specs)
    return specs


def normalize_result(
    *,
    feature_id: str,
    test: dict[str, Any],
    spec_status: dict[str, Any] | None,
    spec_path: str,
    source_candidates: list[str],
) -> dict[str, Any]:
    assertion = str(test.get("assertion") or "")
    title = str(test.get("name") or "")
    if not spec_status:
        return {
            "feature_id": feature_id,
            "test_id": test.get("id"),
            "status": "blocked",
            "summary": f"{title} was generated but did not appear in the Playwright report.",
            "assertion": assertion,
            "evidence": {"test": spec_path, "assertion": assertion},
            "source_candidates": source_candidates,
        }
    status = spec_status.get("status") or "inconclusive"
    error = strip_ansi(spec_status.get("error"))
    if status == "fail" and "SEETHROUGH_WRONG_APP" in error:
        wrong = _wrong_app_message()
        return {
            "feature_id": feature_id,
            "test_id": test.get("id"),
            "status": "blocked",
            "summary": wrong["summary"],
            "assertion": assertion,
            "evidence": {"test": spec_path, "assertion": assertion},
            "source_candidates": source_candidates,
            "failing_step": None,
            "suggested_fix": wrong["suggested_fix"],
        }
    if status == "fail" and "LOGIN_WALL" in error:
        wall = _login_wall_message()
        return {
            "feature_id": feature_id,
            "test_id": test.get("id"),
            "status": "blocked",
            "summary": wall["summary"],
            "assertion": assertion,
            "evidence": {"test": spec_path, "assertion": assertion},
            "source_candidates": source_candidates,
            "failing_step": None,
            "suggested_fix": wall["suggested_fix"],
        }
    if status == "fail" and MISSING_UI.search(error):
        if is_seethrough_base_url():
            wrong = _wrong_app_message()
            summary = wrong["summary"]
            suggested = wrong["suggested_fix"]
        elif "login" in title.lower():
            summary = "The login fields we inferred from source were not on this page."
            suggested = "Enter the running app URL on the scan page, then scan again."
        else:
            summary = (
                "Playwright opened the page but did not find that control. "
                "If this screen is behind login, enter a test login."
            )
            suggested = "Enter a test login on the scan page, then scan again."
        return {
            "feature_id": feature_id,
            "test_id": test.get("id"),
            "status": "blocked",
            "summary": summary,
            "assertion": assertion,
            "evidence": {"test": spec_path, "assertion": assertion},
            "source_candidates": source_candidates,
            "failing_step": None,
            "suggested_fix": suggested,
        }
    if status == "fail":
        if assertion == "no_authenticated_session":
            summary = "Invalid credentials were accepted"
        elif assertion == "did_not_navigate_to_dashboard":
            summary = "After invalid login the browser opened the dashboard. Session creation was not claimed."
        elif assertion == "anonymous_api_unauthorized":
            summary = f"Anonymous request to {test.get('api') or 'the API'} was allowed."
        else:
            summary = error[:400] or f"{title} failed."
    elif status == "pass":
        if assertion == "no_authenticated_session":
            summary = "Invalid login left the session empty."
        elif assertion == "did_not_navigate_to_dashboard":
            summary = "After invalid login the browser did not open the dashboard. Session creation was not checked by this test."
        else:
            summary = f"{title} passed."
    elif status == "blocked" and re.search(r"timed? ?out", error, re.I):
        if assertion == "did_not_navigate_to_dashboard":
            summary = (
                "Invalid login submit did not finish in time. The form may be "
                "waiting on the API, or the app stayed on the dashboard long enough "
                "for Playwright's URL check to expire."
            )
            suggested = "Confirm the backend at REPO_SCAN_TEST_API_URL answers the login request."
        else:
            summary = error[:400] or "The browser test timed out."
            suggested = "Check the Playwright trace; a request or navigation did not finish."
        return {
            "feature_id": feature_id,
            "test_id": test.get("id"),
            "status": "blocked",
            "summary": summary,
            "assertion": assertion,
            "evidence": {
                "test": spec_path,
                "assertion": assertion,
                "trace_path": spec_status.get("trace_path"),
            },
            "source_candidates": source_candidates,
            "failing_step": title,
            "suggested_fix": suggested,
        }
    else:
        summary = error or f"{title} did not finish."
    evidence = {
        "test": spec_path,
        "assertion": assertion,
        "trace_path": spec_status.get("trace_path"),
    }
    return {
        "feature_id": feature_id,
        "test_id": test.get("id"),
        "status": status,
        "summary": summary,
        "assertion": assertion,
        "evidence": evidence,
        "source_candidates": source_candidates,
        "failing_step": title if status == "fail" else None,
        "suggested_fix": (
            "Direct visits to the dashboard already bounce anonymous users, but "
            "submitting invalid credentials opened it. Reject the login response "
            "and do not route to the dashboard on failure."
            if status == "fail" and assertion == "did_not_navigate_to_dashboard"
            else (
                "Inspect the Playwright trace and the auth service."
                if status == "fail"
                else None
            )
        ),
    }


async def run_playwright_test(workdir: str, test_file: str) -> dict[str, Any]:
    allowed = allowed_test_file(workdir, test_file)
    if not allowed:
        return {
            "status": "blocked",
            "reason": "Test file is not on the generated-spec allowlist.",
            "specs": [],
        }
    if not os.path.isfile(PLAYWRIGHT_CLI):
        return {
            "status": "blocked",
            "reason": "@playwright/test is not installed in SeeThrough.",
            "specs": [],
        }
    env = os.environ.copy()
    node_path = os.path.join(_REPO_ROOT, "node_modules")
    existing = env.get("NODE_PATH", "")
    env["NODE_PATH"] = node_path if not existing else f"{node_path}{os.pathsep}{existing}"
    proc = await asyncio.create_subprocess_exec(
        "node",
        PLAYWRIGHT_CLI,
        "test",
        allowed,
        "--reporter=json",
        cwd=workdir,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT_SEC)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return {"status": "blocked", "reason": "Test execution timed out", "specs": []}
    text = (stdout or b"").decode("utf-8", errors="replace")
    err = (stderr or b"").decode("utf-8", errors="replace")
    specs = parse_playwright_json(text)
    if not specs:
        try:
            payload = json.loads(text) if text.strip().startswith("{") else {}
        except json.JSONDecodeError:
            payload = {}
        errors = payload.get("errors") if isinstance(payload, dict) else None
        first_error = ""
        if isinstance(errors, list) and errors and isinstance(errors[0], dict):
            first_error = str(errors[0].get("message") or "")
        return {
            "status": "blocked",
            "reason": (first_error or err).strip()[:240]
            or "Playwright returned no JSON report.",
            "specs": [],
            "raw_error": True,
        }
    return {"status": "ran", "specs": specs, "exit_code": proc.returncode}


def run_playwright_test_sync(workdir: str, test_file: str) -> dict[str, Any]:
    return asyncio.run(run_playwright_test(workdir, test_file))


def self_test() -> int:
    if not is_seethrough_base_url("http://127.0.0.1:3000"):
        print("SeeThrough origin is usually :3000", file=sys.stderr)
        return 2
    if is_seethrough_base_url("http://127.0.0.1:5173"):
        print("Vite :5173 is the scanned app, not SeeThrough", file=sys.stderr)
        return 2
    empty = allowed_test_file("", "tests/seethrough-auth.spec.ts")
    if empty is not None:
        print("empty workdir must reject", file=sys.stderr)
        return 2
    if allowed_test_file("/tmp", "../seethrough-auth.spec.ts") is not None:
        print("path traversal must be rejected", file=sys.stderr)
        return 2
    if allowed_test_file("/tmp", "tests/other.spec.ts") is not None:
        print("non-allowlisted spec must be rejected", file=sys.stderr)
        return 2
    missing = asyncio.run(run_playwright_test("/tmp/does-not-exist", "tests/seethrough-auth.spec.ts"))
    if missing.get("status") != "blocked":
        print("missing allowlisted file should be blocked", file=sys.stderr)
        return 2
    report = parse_playwright_json(
        json.dumps(
            {
                "suites": [
                    {
                        "specs": [
                            {
                                "title": "Invalid credentials do not create a session",
                                "ok": False,
                                "tests": [
                                    {
                                        "results": [
                                            {
                                                "status": "failed",
                                                "error": {"message": "user was present"},
                                                "attachments": [
                                                    {
                                                        "name": "trace",
                                                        "path": "artifacts/auth-002-trace.zip",
                                                    }
                                                ],
                                            }
                                        ]
                                    }
                                ],
                            }
                        ]
                    }
                ]
            }
        )
    )
    if report[0]["status"] != "fail" or report[0]["trace_path"] != "artifacts/auth-002-trace.zip":
        print(f"json report parse failed: {report}", file=sys.stderr)
        return 2
    normalized = normalize_result(
        feature_id="authentication",
        test={
            "id": "auth-gen-003",
            "name": "Invalid credentials do not create a session",
            "assertion": "no_authenticated_session",
        },
        spec_status=report[0],
        spec_path="tests/seethrough-auth.spec.ts",
        source_candidates=["components/LoginForm.tsx", "lib/auth.ts"],
    )
    if normalized["summary"] != "Invalid credentials were accepted":
        print("must only claim accepted credentials when the session test failed", file=sys.stderr)
        return 2
    missing_ui = normalize_result(
        feature_id="authentication",
        test={
            "id": "auth-gen-001",
            "name": "Login page renders",
            "assertion": "Inferred login controls are visible",
        },
        spec_status={
            "status": "fail",
            "error": "\x1b[31mexpect(locator).toBeVisible() failed\x1b[39m Error: element(s) not found",
        },
        spec_path="tests/seethrough-auth.spec.ts",
        source_candidates=["components/LoginForm.tsx"],
    )
    if missing_ui["status"] != "blocked" or "\x1b" in missing_ui["summary"]:
        print("missing login fields on the sandbox URL should be blocked, not a raw Fail", file=sys.stderr)
        return 2
    if "login fields" not in missing_ui["summary"].lower():
        print("missing login fields should not be blamed on SeeThrough", file=sys.stderr)
        return 2
    seethrough = normalize_result(
        feature_id="orders",
        test={
            "id": "orders-b01",
            "name": "Feature form loads",
            "assertion": "page_loaded",
        },
        spec_status={"status": "fail", "error": "Error: SEETHROUGH_WRONG_APP"},
        spec_path="tests/seethrough-orders.spec.ts",
        source_candidates=["app/orders/page.tsx"],
    )
    if seethrough["status"] != "blocked" or "SeeThrough" not in seethrough["summary"]:
        print("SeeThrough fingerprint should block as the wrong app", file=sys.stderr)
        return 2
    wall = normalize_result(
        feature_id="orders",
        test={
            "id": "orders-b01",
            "name": "Feature form loads",
            "assertion": "page_loaded",
        },
        spec_status={"status": "fail", "error": "Error: LOGIN_WALL"},
        spec_path="tests/seethrough-orders.spec.ts",
        source_candidates=["app/orders/page.tsx"],
    )
    if wall["status"] != "blocked" or "login" not in wall["summary"].lower():
        print("login wall should say the feature needs sign-in", file=sys.stderr)
        return 2
    if "SeeThrough" in wall["summary"]:
        print("a login wall is not the SeeThrough server", file=sys.stderr)
        return 2
    timed = normalize_result(
        feature_id="authentication",
        test={
            "id": "auth-gen-002",
            "name": "Invalid credentials do not open the dashboard",
            "assertion": "did_not_navigate_to_dashboard",
        },
        spec_status={"status": "blocked", "error": "Test timeout of 30000ms exceeded."},
        spec_path="tests/seethrough-auth.spec.ts",
        source_candidates=["components/LoginForm.tsx"],
    )
    if "BASE_URL" in (timed.get("suggested_fix") or ""):
        print("a submit timeout must not tell the user to set BASE_URL", file=sys.stderr)
        return 2
    if "API" not in timed["summary"] and "dashboard" not in timed["summary"]:
        print("timeout summary should mention API hang or dashboard URL", file=sys.stderr)
        return 2
    nav_only = normalize_result(
        feature_id="authentication",
        test={
            "id": "auth-gen-002",
            "name": "Invalid credentials do not open the dashboard",
            "assertion": "did_not_navigate_to_dashboard",
        },
        spec_status={"status": "pass", "trace_path": None},
        spec_path="tests/seethrough-auth.spec.ts",
        source_candidates=["components/LoginForm.tsx"],
    )
    if "Session creation was not checked" not in nav_only["summary"]:
        print("dashboard URL pass must not claim a session check", file=sys.stderr)
        return 2
    live = _live_auth_run()
    if live is not None:
        print(live, file=sys.stderr)
        return 2

    print(json.dumps({"ok": True, "selfTest": True}))
    return 0


def _live_auth_run() -> str | None:
    """Run the generated spec against a tiny local login app when Playwright exists."""
    if not os.path.isfile(PLAYWRIGHT_CLI):
        return None
    import http.server
    import socketserver
    import tempfile
    import threading
    from auth_test_gen import generate_auth_spec, infer_auth_evidence

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            return

        def do_GET(self) -> None:
            if self.path.startswith("/login"):
                body = (
                    b"<!doctype html><html><body><form>"
                    b"<label>Email</label><input type='email' name='email' />"
                    b"<label>Password</label><input type='password' name='password' />"
                    b"<button type='submit'>Sign in</button></form></body></html>"
                )
                self.send_response(200)
                self.send_header("content-type", "text/html")
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path.startswith("/dashboard"):
                self.send_response(302)
                self.send_header("location", "/login")
                self.end_headers()
                return
            if self.path.startswith("/api/auth/session"):
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(b"{}")
                return
            if self.path.startswith("/api/stats"):
                self.send_response(401)
                self.end_headers()
                return
            self.send_response(404)
            self.end_headers()

        def do_POST(self) -> None:
            self.send_response(200)
            self.send_header("content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html><body>Stay on login</body></html>")

    evidence = infer_auth_evidence(
        {
            "feature_id": "authentication",
            "entry_points": ["/login"],
            "primary_files": ["components/LoginForm.tsx"],
            "related_features": ["dashboard"],
        },
        {
            "features": [
                {
                    "feature_id": "dashboard",
                    "entry_points": ["/dashboard"],
                    "primary_files": ["app/dashboard/page.tsx", "app/api/stats/route.ts"],
                }
            ]
        },
        {
            "components/LoginForm.tsx": (
                "<form><label>Email</label><input type='email' name='email' />"
                "<label>Password</label><input type='password' name='password' />"
                "<button type='submit'>Sign in</button></form>"
            ),
            "lib/auth.ts": "import { getServerSession } from 'next-auth';\n",
            "app/dashboard/page.tsx": '<div data-testid="private-dashboard"></div>\n',
            "app/api/stats/route.ts": "export async function GET() {}\n",
        },
    )
    spec = generate_auth_spec(evidence)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = httpd.server_address[:2]
    base_url = f"http://{host}:{port}"
    workdir = tempfile.mkdtemp(prefix="seethrough-playwright-")
    try:
        rel = write_playwright_project(workdir, spec, base_url=base_url)
        report = asyncio.run(run_playwright_test(workdir, rel))
        if report.get("status") == "blocked":
            reason = str(report.get("reason") or "")
            if re.search(r"browser|executable|chromium|install", reason, re.I):
                return None
            return f"live Playwright run blocked: {reason}"
        failed = [
            item
            for item in report.get("specs") or []
            if item.get("status") == "fail"
        ]
        if failed:
            message = str(failed[0].get("error") or failed[0])
            if re.search(r"browser|executable|chromium|install", message, re.I):
                return None
            return f"live Playwright run failed: {failed[0]}"
    finally:
        httpd.shutdown()
        httpd.server_close()
    return None


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
