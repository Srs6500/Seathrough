"""Discover the repository's own tests, typecheck, and lint scripts.

GitHub source is enough to catalog them. Execution only happens in an
opt-in workspace — this worker is not a secure sandbox for `npm test`.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import Any

TEST_FILE = re.compile(
    r"(?:^|/)(?:tests?|__tests__|spec)/.+|"
    r"[^/]+\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$|"
    r"(?:^|/)test_[^/]+\.py$|(?:^|/)[^/]+_test\.py$",
    re.I,
)
CONFIG_FILE = re.compile(
    r"(?:^|/)(?:package\.json|tsconfig\.json|pytest\.ini|pyproject\.toml|"
    r"vitest\.config\.\w+|playwright\.config\.\w+|eslint\.config\.\w+|"
    r"\.eslintrc(?:\.\w+)?)$",
    re.I,
)
SKIP_DIR = re.compile(r"(?:^|/)(?:node_modules|\.git|\.next|dist|build|coverage)(?:/|$)")
ALLOW_RUNNERS = ("vitest", "pytest", "tsc")


def _clean(path: Any) -> str:
    return str(path or "").replace("\\", "/").lstrip("./").strip()


def _is_test_file(path: str) -> bool:
    if SKIP_DIR.search(path):
        return False
    return bool(TEST_FILE.search(path))


def _parse_package_scripts(content: str) -> dict[str, str]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return {}
    scripts = data.get("scripts") if isinstance(data, dict) else None
    if not isinstance(scripts, dict):
        return {}
    found: dict[str, str] = {}
    for key in ("test", "lint", "typecheck", "tsc"):
        value = scripts.get(key)
        if isinstance(value, str) and value.strip():
            found[key] = value.strip()
    return found


def index_repo_artifacts(
    files: list[dict[str, Any]] | None,
    sources: dict[str, str] | None,
) -> dict[str, Any]:
    source_map = {
        _clean(key): value for key, value in (sources or {}).items() if value
    }
    tests: list[dict[str, Any]] = []
    configs: list[str] = []
    scripts: dict[str, str] = {}
    for row in files or []:
        path = _clean(row.get("path") if isinstance(row, dict) else row)
        if not path:
            continue
        if _is_test_file(path):
            tests.append({"path": path, "kind": _kind_for(path)})
        if CONFIG_FILE.search(path):
            configs.append(path)
        if path.endswith("package.json"):
            parsed = _parse_package_scripts(source_map.get(path) or "")
            for key, value in parsed.items():
                scripts.setdefault(key, value)
    for path, content in source_map.items():
        if path == "package.json" and "test" not in scripts:
            scripts.update(_parse_package_scripts(content))
    return {
        "tests": tests,
        "configs": configs,
        "scripts": scripts,
        "has_tsconfig": any(item.endswith("tsconfig.json") for item in configs),
        "has_eslint": any("eslint" in item for item in configs),
        "has_pytest": any(
            item.endswith("pytest.ini") or item.endswith("pyproject.toml")
            for item in configs
        ),
        "has_vitest": any("vitest.config" in item for item in configs)
        or "vitest" in " ".join(scripts.values()),
    }


def _kind_for(path: str) -> str:
    lowered = path.lower()
    if lowered.endswith(".py"):
        return "pytest"
    if "playwright" in lowered or "/e2e/" in lowered:
        return "playwright"
    return "vitest"


def tests_for_feature(
    feature: dict[str, Any],
    artifacts: dict[str, Any],
) -> list[dict[str, Any]]:
    files = [_clean(path) for path in feature.get("primary_files") or []]
    name = str(feature.get("name") or feature.get("feature_id") or "").lower()
    fid = str(feature.get("feature_id") or "").lower()
    matched: list[dict[str, Any]] = []
    for item in artifacts.get("tests") or []:
        path = str(item.get("path") or "")
        lowered = path.lower()
        score = 0
        for file_path in files:
            stem = file_path.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()
            folder = "/".join(file_path.split("/")[:-1]).lower()
            if stem and stem in lowered:
                score += 3
            if folder and folder and folder in lowered:
                score += 2
        if fid and fid.replace("-", "") in lowered.replace("-", "").replace("_", ""):
            score += 2
        if name and name.split()[0] in lowered:
            score += 1
        if score <= 0:
            continue
        matched.append({**item, "score": score})
    matched.sort(key=lambda row: (-int(row.get("score") or 0), row.get("path") or ""))
    return matched[:4]


def _workspace() -> str:
    return (os.environ.get("REPO_SCAN_TEST_WORKSPACE") or "").strip()


def _sandbox() -> bool:
    return (os.environ.get("REPO_SCAN_SANDBOX") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _run(command: list[str], cwd: str, timeout: int = 60) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"ok": False, "status": "blocked", "detail": str(error)}
    output = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()[:400]
    if proc.returncode == 0:
        return {"ok": True, "status": "pass", "detail": output or "ok"}
    return {"ok": False, "status": "fail", "detail": output or f"exit {proc.returncode}"}


def run_feature_repo_tests(
    feature: dict[str, Any],
    artifacts: dict[str, Any],
) -> list[dict[str, Any]]:
    matches = tests_for_feature(feature, artifacts)
    results: list[dict[str, Any]] = []
    workspace = _workspace()
    fid = str(feature.get("feature_id") or "feature")
    for index, item in enumerate(matches, start=1):
        path = str(item.get("path") or "")
        kind = str(item.get("kind") or "vitest")
        test = {
            "id": f"{fid}-repo-{index:02d}",
            "name": f"Existing test {path}",
            "type": "repo",
            "assertion": "Repository test mapped to this feature",
            "origin": "repo",
            "requires": ["workspace"],
            "source": path,
        }
        if not workspace or not _sandbox():
            results.append(
                {
                    **test,
                    "status": "inconclusive",
                    "explanation": (
                        f"The repository includes {path}. SeeThrough does not "
                        "execute third-party tests without an opt-in workspace."
                    ),
                    "failing_step": None,
                    "suggested_fix": (
                        "Set REPO_SCAN_TEST_WORKSPACE to a local checkout and "
                        "REPO_SCAN_SANDBOX=1 to run this file."
                    ),
                    "requires": ["workspace", "isolated_environment"],
                }
            )
            continue
        full = os.path.join(workspace, path)
        if not os.path.isfile(full):
            results.append(
                {
                    **test,
                    "status": "blocked",
                    "explanation": f"{path} is in source but missing from the workspace.",
                    "failing_step": None,
                    "suggested_fix": "Point REPO_SCAN_TEST_WORKSPACE at a matching checkout.",
                    "requires": ["workspace"],
                }
            )
            continue
        if kind == "pytest":
            ran = _run([sys.executable, "-m", "pytest", "-q", path], workspace)
        elif kind == "playwright":
            results.append(
                {
                    **test,
                    "status": "inconclusive",
                    "explanation": (
                        f"{path} looks like a Playwright spec written by the "
                        "repo. SeeThrough will not launch that suite from here."
                    ),
                    "failing_step": None,
                    "suggested_fix": None,
                    "requires": ["workspace"],
                }
            )
            continue
        else:
            ran = _run(["npx", "--yes", "vitest", "run", "--reporter=dot", path], workspace)
        results.append(
            {
                **test,
                "status": ran["status"],
                "explanation": ran["detail"]
                or (
                    "The repository test passed."
                    if ran["ok"]
                    else "The repository test failed."
                ),
                "failing_step": path if ran["status"] == "fail" else None,
                "suggested_fix": (
                    "Inspect the failing repository test and the feature it covers."
                    if ran["status"] == "fail"
                    else None
                ),
                "requires": ["workspace", "isolated_environment"],
            }
        )
    return results


def catalog_repo_checks(artifacts: dict[str, Any]) -> list[dict[str, Any]]:
    workspace = _workspace()
    checks: list[dict[str, Any]] = []
    scripts = artifacts.get("scripts") or {}
    if artifacts.get("has_tsconfig") or scripts.get("typecheck") or scripts.get("tsc"):
        checks.append(
            {
                "id": "repo-typecheck",
                "name": "Typecheck",
                "type": "repo",
                "origin": "repo",
                "assertion": "tsc --noEmit",
                "source": "tsconfig.json",
                "command": "tsc",
            }
        )
    if artifacts.get("has_eslint") or scripts.get("lint"):
        checks.append(
            {
                "id": "repo-lint",
                "name": "Lint",
                "type": "repo",
                "origin": "repo",
                "assertion": "eslint",
                "source": next(
                    (
                        item
                        for item in artifacts.get("configs") or []
                        if "eslint" in item
                    ),
                    "package.json",
                ),
                "command": "lint",
            }
        )
    results: list[dict[str, Any]] = []
    for check in checks:
        if not workspace or not _sandbox():
            results.append(
                {
                    **check,
                    "status": "inconclusive",
                    "explanation": (
                        f"The repo declares {check['name'].lower()}. Not run "
                        "without an opt-in workspace."
                    ),
                    "failing_step": None,
                    "suggested_fix": "Set REPO_SCAN_TEST_WORKSPACE to run repo checks.",
                    "requires": ["workspace", "isolated_environment"],
                }
            )
            continue
        command = check.get("command")
        if command == "tsc":
            ran = _run(["npx", "--yes", "tsc", "--noEmit", "--pretty", "false"], workspace, 90)
        elif command == "lint":
            script = str(scripts.get("lint") or "")
            if not script or not re.fullmatch(r"eslint(?:\s[A-Za-z0-9_./\-\*]+)*", script):
                results.append(
                    {
                        **check,
                        "status": "inconclusive",
                        "explanation": (
                            "A lint script exists but is not an allowlisted eslint command."
                        ),
                        "failing_step": None,
                        "suggested_fix": None,
                        "requires": ["workspace"],
                    }
                )
                continue
            ran = _run(["npx", "--yes", *script.split()], workspace, 90)
        else:
            continue
        results.append(
            {
                **check,
                "status": ran["status"],
                "explanation": ran["detail"]
                or f"{check['name']} finished.",
                "failing_step": check["name"] if ran["status"] == "fail" else None,
                "suggested_fix": (
                    f"Fix {check['name'].lower()} in the scanned repository."
                    if ran["status"] == "fail"
                    else None
                ),
                "requires": ["workspace", "isolated_environment"],
            }
        )
    return results


def self_test() -> int:
    artifacts = index_repo_artifacts(
        [
            {"path": "app/login/page.tsx"},
            {"path": "app/login/login.test.ts"},
            {"path": "tests/auth.spec.ts"},
            {"path": "package.json"},
            {"path": "tsconfig.json"},
        ],
        {
            "package.json": json.dumps(
                {"scripts": {"test": "vitest", "lint": "eslint .", "typecheck": "tsc --noEmit"}}
            )
        },
    )
    if not any(item["path"] == "app/login/login.test.ts" for item in artifacts["tests"]):
        print("login.test.ts should be discovered", file=sys.stderr)
        return 2
    if artifacts["scripts"].get("typecheck") != "tsc --noEmit":
        print("package.json typecheck script should be parsed", file=sys.stderr)
        return 2
    mapped = tests_for_feature(
        {
            "feature_id": "authentication",
            "name": "User Authentication",
            "primary_files": ["app/login/page.tsx"],
        },
        artifacts,
    )
    if not any("login.test.ts" in str(item.get("path")) for item in mapped):
        print("auth feature should bind login.test.ts", file=sys.stderr)
        return 2
    os.environ.pop("REPO_SCAN_TEST_WORKSPACE", None)
    os.environ.pop("REPO_SCAN_SANDBOX", None)
    results = run_feature_repo_tests(
        {
            "feature_id": "authentication",
            "name": "User Authentication",
            "primary_files": ["app/login/page.tsx"],
        },
        artifacts,
    )
    if not results or results[0]["status"] != "inconclusive":
        print("repo tests without a workspace should stay inconclusive", file=sys.stderr)
        return 2
    if results[0]["type"] != "repo":
        print("existing tests should be typed as repo", file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, "selfTest": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
