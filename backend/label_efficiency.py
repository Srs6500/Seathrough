"""Use the LLM only after structural evidence, and only on unclear candidates.

Parse, symbols, relationships, entry points, and traversal stay local.
Naming is optional. Merge/split runs only when candidates look ambiguous.
Snippets are fetched only if a structural summary is not enough.
Labels are cached by a fingerprint of files and relationships.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

LLM_STAGES = {
    "parse": False,
    "extract_symbols": False,
    "resolve_relationships": False,
    "identify_entry_points": False,
    "traverse_candidates": False,
    "suggest_feature_names": True,
    "merge_or_split": "sometimes",
    "beginner_explanations": True,
    "verify_functionality": False,
}

FAMILY_TITLES = {
    "auth": "Authentication",
    "payments": "Payments",
}

MAX_SNIPPET_FILES = 3
MAX_SNIPPET_LINES = 24
MAX_SNIPPET_CHARS = 900
CACHE_VERSION = 1


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_cache_path() -> Path:
    override = (os.environ.get("REPO_SCAN_LABEL_CACHE") or "").strip()
    if override:
        return Path(override)
    return repo_root() / ".seethrough" / "feature-label-cache.json"


def llm_required_for(stage: str) -> bool | str:
    return LLM_STAGES.get(stage, False)


def candidate_fingerprint(summary: dict[str, Any], repo_key: str = "") -> str:
    payload = {
        "repo": str(repo_key or "").strip(),
        "folder": summary.get("folder"),
        "source": summary.get("source"),
        "entries": summary.get("entries") or [],
        "shared_files": summary.get("shared_files") or [],
        "relationships": summary.get("relationships") or [],
        "files": [
            {
                "path": item.get("path"),
                "role": item.get("role"),
                "route": item.get("route"),
                "symbols": item.get("symbols") or [],
            }
            for item in summary.get("files") or []
            if isinstance(item, dict)
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def needs_llm_label(summary: dict[str, Any], heuristic: dict[str, Any]) -> bool:
    if summary.get("source") == "shared" or heuristic.get("category") == "infrastructure":
        return False
    if summary.get("source") == "louvain":
        return True
    folder = str(summary.get("folder") or "")
    if folder in FAMILY_TITLES:
        return False
    if heuristic.get("confidence") in {"medium", "high"} and (
        folder or heuristic.get("entry_points")
    ):
        return False
    return True


def refine_needed(clusters: list[dict[str, Any]]) -> bool:
    primaries: list[set[str]] = []
    for item in clusters:
        if item.get("source") == "shared":
            continue
        if item.get("needs_split"):
            return True
        files = {str(path) for path in item.get("files") or [] if str(path).strip()}
        for other in primaries:
            if files & other:
                return True
        primaries.append(files)
        entries = [str(path) for path in item.get("entries") or [] if str(path).strip()]
        if item.get("source") == "louvain" and len(entries) >= 3:
            return True
    return False


def needs_snippets(label: dict[str, Any] | None) -> bool:
    if not label:
        return True
    if str(label.get("confidence") or "").lower() == "low":
        return True
    name = str(label.get("name") or "").strip().lower()
    return name in {"", "untitled cluster", "unknown"}


def select_snippets(
    summary: dict[str, Any],
    files: list[dict[str, Any]] | None,
    *,
    max_files: int = MAX_SNIPPET_FILES,
    max_lines: int = MAX_SNIPPET_LINES,
) -> list[dict[str, str]]:
    rows = {
        str(row.get("path") or "").replace("\\", "/").lstrip("./"): row
        for row in (files or [])
        if isinstance(row, dict) and row.get("path")
    }
    ranked: list[dict[str, Any]] = []
    for item in summary.get("files") or []:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "")
        row = rows.get(path)
        if not row or not isinstance(row.get("content"), str) or not row["content"].strip():
            continue
        rank = 0 if item.get("role") in {"page", "api_route"} else 1
        ranked.append({"path": path, "rank": rank, "content": row["content"]})
    ranked.sort(key=lambda item: (item["rank"], item["path"]))
    snippets: list[dict[str, str]] = []
    for item in ranked[:max_files]:
        lines = [line for line in item["content"].splitlines() if line.strip()][:max_lines]
        text = "\n".join(lines)[:MAX_SNIPPET_CHARS]
        if text:
            snippets.append({"path": item["path"], "text": text})
    return snippets


class LabelCache:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_cache_path()
        self._entries: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.is_file():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict) or raw.get("version") != CACHE_VERSION:
            return
        entries = raw.get("entries")
        if isinstance(entries, dict):
            self._entries = entries

    def get(self, fingerprint: str) -> dict[str, Any] | None:
        item = self._entries.get(fingerprint)
        if not isinstance(item, dict):
            return None
        label = item.get("label")
        return dict(label) if isinstance(label, dict) else None

    def put(self, fingerprint: str, label: dict[str, Any]) -> None:
        if not fingerprint or not isinstance(label, dict):
            return
        stored = {
            key: label[key]
            for key in (
                "name",
                "category",
                "description",
                "entry_points",
                "evidence_files",
                "needs_split",
                "confidence",
                "labeled_by",
            )
            if key in label
        }
        self._entries[fingerprint] = {"label": stored}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({"version": CACHE_VERSION, "entries": self._entries}, ensure_ascii=True),
            encoding="utf-8",
        )


def self_test() -> int:
    from tempfile import TemporaryDirectory

    if llm_required_for("parse") or llm_required_for("traverse_candidates"):
        print("parse and traversal must not require an LLM", file=sys.stderr)
        return 2
    if llm_required_for("suggest_feature_names") is not True:
        print("naming may use an LLM", file=sys.stderr)
        return 2
    if llm_required_for("merge_or_split") != "sometimes":
        print("merge/split should be optional", file=sys.stderr)
        return 2
    if llm_required_for("verify_functionality"):
        print("verification must not be an LLM job", file=sys.stderr)
        return 2

    summary = {
        "folder": "auth",
        "source": "route",
        "files": [
            {
                "path": "app/login/page.tsx",
                "role": "page",
                "route": "/login",
                "symbols": ["LoginPage"],
            }
        ],
        "relationships": ["LoginPage renders LoginForm"],
        "entries": ["app/login/page.tsx"],
    }
    first = candidate_fingerprint(summary, "owner/repo")
    summary["relationships"] = ["LoginPage calls signIn"]
    second = candidate_fingerprint(summary, "owner/repo")
    if first == second:
        print("fingerprint should change when relationships change", file=sys.stderr)
        return 2
    if candidate_fingerprint(summary, "owner/repo") != second:
        print("fingerprint should be stable for the same evidence", file=sys.stderr)
        return 2

    if needs_llm_label(summary, {"category": "feature", "confidence": "medium", "entry_points": ["/login"]}):
        print("clear auth structure should not call the model", file=sys.stderr)
        return 2
    if not needs_llm_label(
        {"source": "louvain", "files": [{"path": "utils/misc.ts", "role": "service", "symbols": []}]},
        {"category": "unknown", "confidence": "low"},
    ):
        print("unclear leftovers should ask the model", file=sys.stderr)
        return 2

    if refine_needed(
        [
            {"source": "route", "files": ["app/login/page.tsx", "lib/auth.ts"]},
            {"source": "route", "files": ["app/dashboard/page.tsx", "lib/db.ts"]},
        ]
    ):
        print("disjoint features should not trigger refine", file=sys.stderr)
        return 2
    if not refine_needed(
        [
            {"source": "route", "files": ["app/login/page.tsx", "lib/shared-feature.ts"]},
            {"source": "route", "files": ["app/settings/page.tsx", "lib/shared-feature.ts"]},
        ]
    ):
        print("overlapping primary files should trigger refine", file=sys.stderr)
        return 2

    snippets = select_snippets(
        {
            "files": [
                {"path": "app/mystery/page.tsx", "role": "page"},
                {"path": "lib/misc.ts", "role": "service"},
            ]
        },
        [
            {
                "path": "app/mystery/page.tsx",
                "content": "export default function Mystery() {\n  return <p>zebra-quokka-42</p>;\n}\n",
            },
            {"path": "lib/misc.ts", "content": "export function helper() { return 1; }\n"},
        ],
    )
    if not snippets or "zebra-quokka-42" not in snippets[0]["text"]:
        print("unclear candidates may fetch truncated entry snippets", file=sys.stderr)
        return 2
    if any(item["path"] == "lib/misc.ts" for item in snippets) and snippets[0]["path"] != "app/mystery/page.tsx":
        print("entry files should be preferred for snippets", file=sys.stderr)
        return 2

    with TemporaryDirectory() as tmp:
        cache = LabelCache(Path(tmp) / "labels.json")
        cache.put(first, {"name": "User Authentication", "confidence": "high", "category": "feature"})
        hit = cache.get(first)
        if not hit or hit["name"] != "User Authentication":
            print("cache should return a stored label", file=sys.stderr)
            return 2
        if cache.get(second):
            print("changed fingerprint must miss the cache", file=sys.stderr)
            return 2

    print(json.dumps({"ok": True, "selfTest": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
