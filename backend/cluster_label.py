"""Name feature clusters from a compact structural summary — never full files."""

from __future__ import annotations

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Protocol

from file_graph import classify_role, route_for_path
from feature_discovery import entry_family, families_compatible
from label_efficiency import (
    LabelCache,
    candidate_fingerprint,
    llm_required_for,
    needs_llm_label,
    needs_snippets,
    refine_needed,
    select_snippets,
)

MAX_SYMBOLS_PER_FILE = 8
MAX_FILES_IN_SUMMARY = 40
MAX_RELATIONSHIPS = 24
MAX_LLM_CLUSTERS = 8
LLM_WORKERS = 4

CATEGORIES = frozenset({"feature", "infrastructure", "unknown"})
CONFIDENCES = frozenset({"high", "medium", "low"})

SHARED_NAMES = {
    "ui": "Shared UI kit",
    "layout": "Shared layout",
    "lib": "Shared application context",
    "shell": "Application shell",
    "shared": "Shared infrastructure",
}
FAMILY_TITLES = {
    "auth": "Authentication",
    "payments": "Payments",
}
GENERIC_EVIDENCE = {
    "button",
    "form",
    "navbar",
    "cn",
    "database",
    "db",
    "prisma",
    "client",
}

REFINE_PROMPT = """You refine route-seeded feature candidates.

Do not assume one cluster is one feature.
Shared buttons, forms, and database clients are not a reason
to merge unrelated product areas.

Suggest merging related entry points (login + signup + logout)
or mark an overly broad group for a split.

Requirements:
- Cite evidence_files from the candidates.
- Do not invent files, APIs, or services.
- Do not merge authentication with checkout just because both
  use Button or database.ts.

Return JSON:
{
  "merges": [
    {
      "cluster_ids": ["cluster_0", "cluster_1"],
      "reason": "string",
      "evidence_files": ["string"]
    }
  ],
  "splits": [
    {
      "cluster_id": "cluster_2",
      "reason": "string",
      "evidence_files": ["string"]
    }
  ]
}

Input:
"""

FEATURE_LABEL_PROMPT = """You are a software feature discovery engine.

Given a group of related code files and their
verified relationships, identify its likely
user-facing functionality.

Requirements:
- Name the functionality in simple English.
- Explain what the feature appears to do.
- Identify its user-facing entry point.
- Cite files supporting the interpretation.
- Do not infer that a feature works merely
  because relevant code exists.
- Do not invent APIs, database connections,
  or authentication mechanisms.
- If the cluster contains unrelated functionality,
  set needs_split=true.
- If it is shared infrastructure rather than a
  product feature, classify it accordingly.

Return JSON:
{
  "name": "string",
  "category": "feature | infrastructure | unknown",
  "description": "string",
  "entry_points": ["string"],
  "evidence_files": ["string"],
  "needs_split": false,
  "confidence": "high | medium | low"
}

Input:
"""


class LlmClientProtocol(Protocol):
    def generate(self, prompt: str, response_format: str | None = None) -> str: ...


def _clean_path(path: Any) -> str:
    return str(path or "").replace("\\", "/").lstrip("./").strip()


def _symbol_names(row: dict[str, Any] | None) -> list[str]:
    names: list[str] = []
    if not row:
        return names
    for item in row.get("symbols") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
        if len(names) >= MAX_SYMBOLS_PER_FILE:
            break
    return names


def _display_name(path: str, symbols: list[str]) -> str:
    for name in symbols:
        if name[:1].isupper() or name.endswith("Page"):
            return name
    if symbols:
        return symbols[0]
    stem = path.rsplit("/", 1)[-1]
    return stem.rsplit(".", 1)[0]


def _humanize(slug: str) -> str:
    cleaned = re.sub(r"[-_]+", " ", slug).strip()
    return cleaned.title() if cleaned else "Untitled cluster"


def build_cluster_summary(
    cluster: dict[str, Any],
    repo_graph: dict[str, Any] | None = None,
    files: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compact roles / symbols / routes / relationships. No file bodies."""
    graph = repo_graph if isinstance(repo_graph, dict) else {}
    roles = {
        str(node.get("id") or ""): str(node.get("role") or "")
        for node in graph.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    }
    file_rows = {
        _clean_path(row.get("path")): row
        for row in (files or [])
        if isinstance(row, dict) and _clean_path(row.get("path"))
    }
    raw_files = cluster.get("files") or []
    paths = [_clean_path(item) for item in raw_files if _clean_path(item)]
    path_set = set(paths)
    summary_files: list[dict[str, Any]] = []
    for path in paths[:MAX_FILES_IN_SUMMARY]:
        role = roles.get(path) or classify_role(path) or "component"
        symbols = _symbol_names(file_rows.get(path))
        entry: dict[str, Any] = {
            "path": path,
            "role": role,
            "symbols": symbols,
        }
        route = route_for_path(path)
        if route:
            entry["route"] = route
        summary_files.append(entry)

    relationships: list[str] = []
    display = {
        item["path"]: _display_name(item["path"], item.get("symbols") or [])
        for item in summary_files
    }
    for edge in graph.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        source = _clean_path(edge.get("source"))
        target = _clean_path(edge.get("target"))
        edge_type = str(edge.get("type") or "").strip()
        if source not in path_set or target not in path_set:
            continue
        if edge_type not in {"renders", "calls", "requests"}:
            continue
        sentence = f"{display.get(source, source)} {edge_type} {display.get(target, target)}"
        if sentence not in relationships:
            relationships.append(sentence)
        if len(relationships) >= MAX_RELATIONSHIPS:
            break

    summary: dict[str, Any] = {
        "cluster_id": str(cluster.get("cluster_id") or "cluster_0"),
        "files": summary_files,
        "relationships": relationships,
    }
    if cluster.get("source"):
        summary["source"] = cluster["source"]
    if cluster.get("label"):
        summary["folder"] = cluster["label"]
    if cluster.get("entries"):
        summary["entries"] = [
            _clean_path(path) for path in cluster.get("entries") or [] if _clean_path(path)
        ]
    if cluster.get("shared_files"):
        summary["shared_files"] = [
            _clean_path(path)
            for path in cluster.get("shared_files") or []
            if _clean_path(path)
        ]
    return summary


def build_feature_label_prompt(cluster: dict[str, Any]) -> str:
    payload = {
        key: value
        for key, value in cluster.items()
        if key != "snippets"
    }
    prompt = FEATURE_LABEL_PROMPT + json.dumps(payload, ensure_ascii=True, indent=2)
    snippets = cluster.get("snippets")
    if snippets:
        prompt += (
            "\n\nEntry-file snippets (truncated; used only because the "
            "structural summary was unclear):\n"
        )
        prompt += json.dumps(snippets, ensure_ascii=True, indent=2)
    return prompt


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Model did not return JSON.")
        parsed = json.loads(cleaned[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Model JSON must be an object.")
    return parsed


def _as_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def sanitize_label(result: dict[str, Any], allowed_files: set[str]) -> dict[str, Any]:
    evidence = _as_string_list(result.get("evidence_files"))
    if not set(evidence).issubset(allowed_files):
        raise ValueError("Invalid evidence references")
    if not evidence:
        evidence = sorted(allowed_files)[:8]
    category = str(result.get("category") or "unknown").strip().lower()
    if category not in CATEGORIES:
        category = "unknown"
    confidence = str(result.get("confidence") or "low").strip().lower()
    if confidence not in CONFIDENCES:
        confidence = "low"
    name = str(result.get("name") or "").strip() or "Untitled cluster"
    description = str(result.get("description") or "").strip()
    return {
        "name": name[:80],
        "category": category,
        "description": description[:400],
        "entry_points": _as_string_list(result.get("entry_points"))[:8],
        "evidence_files": evidence,
        "needs_split": bool(result.get("needs_split")),
        "confidence": confidence,
    }


def heuristic_label(summary: dict[str, Any]) -> dict[str, Any]:
    files = summary.get("files") or []
    paths = [_clean_path(item.get("path")) for item in files if isinstance(item, dict)]
    routes = [
        str(item.get("route"))
        for item in files
        if isinstance(item, dict) and item.get("route")
    ]
    source = str(summary.get("source") or "")
    folder = str(summary.get("folder") or "")
    if source == "shared":
        name = SHARED_NAMES.get(folder, "Shared infrastructure")
        category = "infrastructure"
        description = "Shared code used by multiple features. Not a product feature by itself."
        confidence = "medium"
    elif folder in FAMILY_TITLES:
        name = FAMILY_TITLES[folder]
        category = "feature"
        description = f"Related routes grouped as {name.lower()}."
        confidence = "medium"
    elif folder:
        name = _humanize(folder)
        category = "feature"
        description = f"Code grouped from the {folder} entry points."
        confidence = "medium" if routes else "low"
    elif routes:
        name = _humanize(routes[0].strip("/").replace("/", " ") or "home")
        category = "feature"
        description = f"Code reachable from the {routes[0]} route."
        confidence = "medium"
    elif paths:
        name = _humanize(paths[0].rsplit("/", 1)[-1].rsplit(".", 1)[0])
        category = "unknown"
        description = "Related files with no clear user-facing name yet."
        confidence = "low"
    else:
        name = "Untitled cluster"
        category = "unknown"
        description = "Empty cluster."
        confidence = "low"
    evidence = [
        str(item.get("path"))
        for item in files
        if isinstance(item, dict) and item.get("role") == "page" and item.get("path")
    ] or paths[:4]
    return {
        "name": name,
        "category": category,
        "description": description,
        "entry_points": routes[:8],
        "evidence_files": evidence,
        "needs_split": False,
        "confidence": confidence,
        "labeled_by": "heuristic",
    }


def label_cluster(cluster: dict[str, Any], llm_client: LlmClientProtocol) -> dict[str, Any]:
    prompt = build_feature_label_prompt(cluster)
    for item in cluster.get("files") or []:
        if isinstance(item, dict) and "content" in item:
            raise ValueError("Cluster summary must not include file contents.")
    response = llm_client.generate(prompt=prompt, response_format="json")
    result = _extract_json_object(response)
    allowed_files = {
        _clean_path(item.get("path"))
        for item in cluster.get("files") or []
        if isinstance(item, dict)
    }
    labeled = sanitize_label(result, allowed_files)
    labeled["labeled_by"] = "llm"
    return {
        "cluster_id": cluster.get("cluster_id"),
        **labeled,
    }


def _merge(cluster: dict[str, Any], summary: dict[str, Any], labeled: dict[str, Any]) -> dict[str, Any]:
    merged = {
        "cluster_id": cluster.get("cluster_id"),
        "files": [_clean_path(path) for path in (cluster.get("files") or [])],
        **{key: labeled[key] for key in labeled if key != "cluster_id"},
    }
    if cluster.get("source"):
        merged["source"] = cluster["source"]
    if cluster.get("label"):
        merged["label"] = cluster["label"]
    if cluster.get("entries"):
        merged["entries"] = [_clean_path(path) for path in cluster.get("entries") or []]
    if cluster.get("shared_files"):
        merged["shared_files"] = [
            _clean_path(path) for path in cluster.get("shared_files") or []
        ]
    if not merged.get("entry_points"):
        merged["entry_points"] = [
            route
            for path in merged.get("entries") or []
            if (route := route_for_path(path))
        ]
    if cluster.get("needs_split"):
        merged["needs_split"] = True
    merged["summary"] = {
        "files": summary.get("files") or [],
        "relationships": summary.get("relationships") or [],
    }
    return merged


def _file_stem(path: str) -> str:
    return path.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()


def evidence_supports_merge(
    left: dict[str, Any],
    right: dict[str, Any],
    evidence_files: list[str],
) -> bool:
    allowed = set(left.get("files") or []) | set(right.get("files") or [])
    allowed |= set(left.get("shared_files") or []) | set(right.get("shared_files") or [])
    cleaned = [_clean_path(path) for path in evidence_files if _clean_path(path)]
    if not cleaned or not set(cleaned).issubset(allowed):
        return False
    if all(_file_stem(path) in GENERIC_EVIDENCE or path in (left.get("shared_files") or []) or path in (right.get("shared_files") or []) for path in cleaned):
        return False
    left_family = str(left.get("label") or entry_family((left.get("entries") or left.get("files") or [""])[0]))
    right_family = str(right.get("label") or entry_family((right.get("entries") or right.get("files") or [""])[0]))
    return families_compatible(left_family, right_family)


def apply_refine_decisions(
    clusters: list[dict[str, Any]],
    decisions: dict[str, Any],
) -> list[dict[str, Any]]:
    by_id = {str(item.get("cluster_id")): dict(item) for item in clusters}
    for merge in decisions.get("merges") or []:
        if not isinstance(merge, dict):
            continue
        ids = [str(item) for item in merge.get("cluster_ids") or [] if str(item) in by_id]
        if len(ids) < 2:
            continue
        evidence = [str(item) for item in merge.get("evidence_files") or []]
        left = by_id[ids[0]]
        for other_id in ids[1:]:
            right = by_id.get(other_id)
            if not right or not evidence_supports_merge(left, right, evidence):
                continue
            left["files"] = sorted(set(left.get("files") or []) | set(right.get("files") or []))
            left["shared_files"] = sorted(
                set(left.get("shared_files") or []) | set(right.get("shared_files") or [])
            )
            left["entries"] = sorted(set(left.get("entries") or []) | set(right.get("entries") or []))
            del by_id[other_id]
    for split in decisions.get("splits") or []:
        if not isinstance(split, dict):
            continue
        cluster = by_id.get(str(split.get("cluster_id") or ""))
        evidence = [str(item) for item in split.get("evidence_files") or []]
        if not cluster or not evidence:
            continue
        allowed = set(cluster.get("files") or []) | set(cluster.get("shared_files") or [])
        if not set(evidence).issubset(allowed):
            continue
        cluster["needs_split"] = True
    return list(by_id.values())


def refine_feature_groups(
    clusters: list[dict[str, Any]],
    llm_client: LlmClientProtocol,
) -> list[dict[str, Any]]:
    payload = [
        {
            "cluster_id": item.get("cluster_id"),
            "label": item.get("label"),
            "entries": item.get("entries") or [],
            "files": item.get("files") or [],
            "shared_files": item.get("shared_files") or [],
        }
        for item in clusters
        if item.get("source") != "shared"
    ]
    if len(payload) < 2:
        return clusters
    prompt = REFINE_PROMPT + json.dumps(payload, ensure_ascii=True)
    response = llm_client.generate(prompt=prompt, response_format="json")
    decisions = _extract_json_object(response)
    return apply_refine_decisions(clusters, decisions)


def _label_one_candidate(
    summary: dict[str, Any],
    files: list[dict[str, Any]] | None,
    client: LlmClientProtocol,
) -> tuple[dict[str, Any], bool]:
    used_snippets = False
    labeled = label_cluster(summary, client)
    if needs_snippets(labeled):
        snippets = select_snippets(summary, files)
        if snippets:
            used_snippets = True
            retry = dict(summary)
            retry["snippets"] = snippets
            labeled = label_cluster(retry, client)
    return labeled, used_snippets


def attach_cluster_labels(
    clusters: list[dict[str, Any]],
    repo_graph: dict[str, Any] | None = None,
    files: list[dict[str, Any]] | None = None,
    *,
    label_with_llm: bool = False,
    llm_client: LlmClientProtocol | None = None,
    repo_key: str = "",
    cache: LabelCache | None = None,
    stats: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    labeling = {
        "llm_required": {
            key: llm_required_for(key)
            for key in (
                "parse",
                "extract_symbols",
                "resolve_relationships",
                "identify_entry_points",
                "traverse_candidates",
                "suggest_feature_names",
                "merge_or_split",
                "beginner_explanations",
                "verify_functionality",
            )
        },
        "llm_calls": 0,
        "cache_hits": 0,
        "heuristic": 0,
        "snippets_used": 0,
        "refined": False,
    }
    if not clusters:
        if stats is not None:
            stats.update(labeling)
        return []
    working = [dict(item) for item in clusters]
    client = llm_client
    if label_with_llm and client is None:
        try:
            from llm_client import LlmClient, has_llm_config

            if has_llm_config():
                client = LlmClient()
        except Exception:
            client = None
    should_refine = (
        label_with_llm and client is not None and refine_needed(working)
    )
    if should_refine:
        try:
            working = refine_feature_groups(working, client)
            labeling["refined"] = True
            labeling["llm_calls"] += 1
        except Exception:
            pass
    summaries = [build_cluster_summary(cluster, repo_graph, files) for cluster in working]
    store = cache if cache is not None else LabelCache()

    llm_indexes: list[int] = []
    labeled_by_index: dict[int, dict[str, Any]] = {}
    fingerprints: dict[int, str] = {}
    for index, summary in enumerate(summaries):
        heuristic = heuristic_label(summary)
        fingerprint = candidate_fingerprint(summary, repo_key)
        fingerprints[index] = fingerprint
        cached = store.get(fingerprint)
        if cached:
            cached = dict(cached)
            cached.setdefault("labeled_by", "cache")
            labeled_by_index[index] = cached
            labeling["cache_hits"] += 1
            continue
        if not label_with_llm or client is None or not needs_llm_label(summary, heuristic):
            labeled_by_index[index] = heuristic
            labeling["heuristic"] += 1
            continue
        llm_indexes.append(index)
    llm_indexes = llm_indexes[:MAX_LLM_CLUSTERS]

    if llm_indexes and client is not None:
        def _one(index: int) -> tuple[int, dict[str, Any], bool]:
            labeled, used_snippets = _label_one_candidate(summaries[index], files, client)
            return index, labeled, used_snippets

        with ThreadPoolExecutor(max_workers=min(LLM_WORKERS, len(llm_indexes))) as pool:
            futures = [pool.submit(_one, index) for index in llm_indexes]
            for future in as_completed(futures):
                try:
                    index, labeled, used_snippets = future.result()
                    labeled_by_index[index] = labeled
                    labeling["llm_calls"] += 1 + (1 if used_snippets else 0)
                    if used_snippets:
                        labeling["snippets_used"] += 1
                    store.put(fingerprints[index], labeled)
                except Exception:
                    continue

    merged: list[dict[str, Any]] = []
    for index, cluster in enumerate(working):
        summary = summaries[index]
        labeled = labeled_by_index.get(index) or heuristic_label(summary)
        if index not in labeled_by_index:
            labeling["heuristic"] += 1
        combined = _merge(cluster, summary, labeled)
        combined["fingerprint"] = fingerprints.get(index)
        merged.append(combined)
    if stats is not None:
        stats.update(labeling)
    return merged


def self_test() -> int:
    if route_for_path("app/login/page.tsx") != "/login":
        print("login page should map to /login", file=sys.stderr)
        return 2
    if route_for_path("web/src/features/auth/LoginPage.tsx") != "/login":
        print("named LoginPage should map to /login", file=sys.stderr)
        return 2

    cluster = {
        "cluster_id": "cluster_0",
        "source": "route",
        "files": [
            "app/login/page.tsx",
            "components/LoginForm.tsx",
            "lib/auth.ts",
        ],
    }
    graph = {
        "nodes": [
            {"id": "app/login/page.tsx", "role": "page"},
            {"id": "components/LoginForm.tsx", "role": "component"},
            {"id": "lib/auth.ts", "role": "service"},
        ],
        "edges": [
            {
                "source": "app/login/page.tsx",
                "target": "components/LoginForm.tsx",
                "type": "renders",
            },
            {
                "source": "components/LoginForm.tsx",
                "target": "lib/auth.ts",
                "type": "calls",
            },
        ],
    }
    files = [
        {
            "path": "app/login/page.tsx",
            "symbols": [{"name": "LoginPage"}],
            "content": "export default function LoginPage() { return <LoginForm />; }",
        },
        {
            "path": "components/LoginForm.tsx",
            "symbols": [{"name": "LoginForm"}, {"name": "handleSubmit"}],
            "content": "export function LoginForm() { signIn(); }",
        },
        {
            "path": "lib/auth.ts",
            "symbols": [{"name": "signIn"}, {"name": "verifySession"}],
            "content": "export function signIn() {}",
        },
    ]
    summary = build_cluster_summary(cluster, graph, files)
    dumped = json.dumps(summary)
    if "export default" in dumped or "export function" in dumped:
        print("summary leaked file contents", file=sys.stderr)
        return 2
    if any("content" in item for item in summary["files"]):
        print("summary files must not include content", file=sys.stderr)
        return 2
    by_path = {item["path"]: item for item in summary["files"]}
    if by_path["app/login/page.tsx"].get("route") != "/login":
        print("summary should include the /login route", file=sys.stderr)
        return 2
    if by_path["app/login/page.tsx"]["symbols"] != ["LoginPage"]:
        print("summary should keep LoginPage symbol only", file=sys.stderr)
        return 2
    if "LoginPage renders LoginForm" not in summary["relationships"]:
        print(f"missing render relationship: {summary['relationships']}", file=sys.stderr)
        return 2
    if "LoginForm calls signIn" not in summary["relationships"]:
        print(f"missing call relationship: {summary['relationships']}", file=sys.stderr)
        return 2

    prompt = build_feature_label_prompt(summary)
    if "software feature discovery engine" not in prompt:
        print("prompt should include the discovery instructions", file=sys.stderr)
        return 2
    if "export default function LoginPage" in prompt:
        print("prompt must not include file bodies", file=sys.stderr)
        return 2

    class GoodClient:
        def generate(self, prompt: str, response_format: str | None = None) -> str:
            if response_format != "json":
                raise ValueError("expected json mode")
            if "export default function" in prompt:
                raise ValueError("prompt contained file body")
            return json.dumps(
                {
                    "name": "User Authentication",
                    "category": "feature",
                    "description": "Allows users to log in to the application",
                    "entry_points": ["/login"],
                    "evidence_files": [
                        "app/login/page.tsx",
                        "components/LoginForm.tsx",
                        "lib/auth.ts",
                    ],
                    "needs_split": False,
                    "confidence": "high",
                }
            )

    labeled = label_cluster(summary, GoodClient())
    if labeled["name"] != "User Authentication":
        print(f"unexpected name {labeled['name']}", file=sys.stderr)
        return 2
    if labeled["confidence"] != "high" or labeled["category"] != "feature":
        print("login cluster should be a high-confidence feature", file=sys.stderr)
        return 2

    class BadEvidenceClient:
        def generate(self, prompt: str, response_format: str | None = None) -> str:
            return json.dumps(
                {
                    "name": "Payments",
                    "category": "feature",
                    "description": "Invented",
                    "entry_points": ["/pay"],
                    "evidence_files": ["lib/secret-stripe.ts"],
                    "needs_split": False,
                    "confidence": "high",
                }
            )

    try:
        label_cluster(summary, BadEvidenceClient())
        print("invalid evidence should be rejected", file=sys.stderr)
        return 2
    except ValueError as error:
        if "evidence" not in str(error).lower():
            print(f"wrong error for bad evidence: {error}", file=sys.stderr)
            return 2

    class InvalidJsonClient:
        def generate(self, prompt: str, response_format: str | None = None) -> str:
            return "not json"

    attached = attach_cluster_labels(
        [cluster],
        graph,
        files,
        label_with_llm=True,
        llm_client=InvalidJsonClient(),
    )
    if attached[0].get("labeled_by") != "heuristic":
        print("invalid model JSON should fall back to heuristic", file=sys.stderr)
        return 2
    if not attached[0].get("name"):
        print("heuristic fallback should still name the cluster", file=sys.stderr)
        return 2

    empty = attach_cluster_labels([], {}, [], label_with_llm=True)
    if empty != []:
        print("empty clusters should stay empty", file=sys.stderr)
        return 2

    shared = attach_cluster_labels(
        [
            {
                "cluster_id": "cluster_1",
                "source": "shared",
                "label": "ui",
                "files": ["web/src/components/ui/button.tsx"],
            }
        ],
        {"nodes": [{"id": "web/src/components/ui/button.tsx", "role": "component"}], "edges": []},
        [{"path": "web/src/components/ui/button.tsx", "symbols": [{"name": "Button"}]}],
        label_with_llm=True,
        llm_client=GoodClient(),
    )
    if shared[0]["category"] != "infrastructure" or shared[0]["labeled_by"] != "heuristic":
        print("shared clusters should be heuristic infrastructure", file=sys.stderr)
        return 2

    login_c = {
        "cluster_id": "cluster_0",
        "source": "route",
        "label": "auth",
        "entries": ["app/login/page.tsx"],
        "files": ["app/login/page.tsx", "lib/auth.ts"],
        "shared_files": ["components/Button.tsx"],
    }
    checkout_c = {
        "cluster_id": "cluster_1",
        "source": "route",
        "label": "payments",
        "entries": ["app/checkout/page.tsx"],
        "files": ["app/checkout/page.tsx", "lib/stripe.ts"],
        "shared_files": ["components/Button.tsx"],
    }
    rejected = apply_refine_decisions(
        [login_c, checkout_c],
        {
            "merges": [
                {
                    "cluster_ids": ["cluster_0", "cluster_1"],
                    "reason": "both use Button",
                    "evidence_files": ["components/Button.tsx"],
                }
            ]
        },
    )
    if len(rejected) != 2:
        print("Button evidence must not merge auth and checkout", file=sys.stderr)
        return 2
    signup_c = {
        "cluster_id": "cluster_2",
        "source": "route",
        "label": "auth",
        "entries": ["app/signup/page.tsx"],
        "files": ["app/signup/page.tsx", "lib/auth.ts"],
        "shared_files": ["components/Button.tsx"],
    }
    accepted = apply_refine_decisions(
        [login_c, signup_c],
        {
            "merges": [
                {
                    "cluster_ids": ["cluster_0", "cluster_2"],
                    "reason": "both call auth.ts",
                    "evidence_files": ["lib/auth.ts"],
                }
            ]
        },
    )
    if len(accepted) != 1 or set(accepted[0]["entries"]) != {
        "app/login/page.tsx",
        "app/signup/page.tsx",
    }:
        print("auth.ts evidence should merge login and signup", file=sys.stderr)
        return 2

    from tempfile import TemporaryDirectory

    from label_efficiency import LabelCache

    class CountingClient:
        def __init__(self) -> None:
            self.calls = 0

        def generate(self, prompt: str, response_format: str | None = None) -> str:
            self.calls += 1
            raise AssertionError("structurally clear auth should not call the model")

    with TemporaryDirectory() as tmp:
        cache = LabelCache(Path(tmp) / "labels.json")
        counted = CountingClient()
        clear = attach_cluster_labels(
            [
                {
                    "cluster_id": "cluster_0",
                    "source": "route",
                    "label": "auth",
                    "entries": ["app/login/page.tsx"],
                    "files": [
                        "app/login/page.tsx",
                        "components/LoginForm.tsx",
                        "lib/auth.ts",
                    ],
                }
            ],
            graph,
            files,
            label_with_llm=True,
            llm_client=counted,
            cache=cache,
        )
        if counted.calls != 0 or clear[0].get("labeled_by") != "heuristic":
            print("clear structural candidates should skip the model", file=sys.stderr)
            return 2

        class UnclearClient:
            def __init__(self) -> None:
                self.prompts: list[str] = []

            def generate(self, prompt: str, response_format: str | None = None) -> str:
                self.prompts.append(prompt)
                marker = "zebra-quokka-42"
                if marker not in prompt:
                    return json.dumps(
                        {
                            "name": "Mystery",
                            "category": "unknown",
                            "description": "Unclear",
                            "entry_points": [],
                            "evidence_files": ["app/mystery/page.tsx"],
                            "needs_split": False,
                            "confidence": "low",
                        }
                    )
                return json.dumps(
                    {
                        "name": "Mystery Page",
                        "category": "feature",
                        "description": "A mystery screen",
                        "entry_points": ["/mystery"],
                        "evidence_files": ["app/mystery/page.tsx"],
                        "needs_split": False,
                        "confidence": "medium",
                    }
                )

        unclear_client = UnclearClient()
        unclear_stats: dict[str, Any] = {}
        unclear_cluster = {
            "cluster_id": "cluster_9",
            "source": "louvain",
            "files": ["app/mystery/page.tsx"],
        }
        unclear_files = [
            {
                "path": "app/mystery/page.tsx",
                "symbols": [{"name": "Mystery"}],
                "content": (
                    "export default function Mystery() {\n"
                    "  return <p>zebra-quokka-42</p>;\n"
                    "}\n"
                ),
            }
        ]
        first = attach_cluster_labels(
            [unclear_cluster],
            {
                "nodes": [{"id": "app/mystery/page.tsx", "role": "page"}],
                "edges": [],
            },
            unclear_files,
            label_with_llm=True,
            llm_client=unclear_client,
            cache=LabelCache(Path(tmp) / "unclear.json"),
            stats=unclear_stats,
        )
        if "zebra-quokka-42" in unclear_client.prompts[0]:
            print("first LLM pass must stay structural", file=sys.stderr)
            return 2
        if not any("zebra-quokka-42" in prompt for prompt in unclear_client.prompts[1:]):
            print("low-confidence labels may fetch a truncated snippet", file=sys.stderr)
            return 2
        if first[0]["name"] != "Mystery Page" or unclear_stats.get("snippets_used") != 1:
            print("snippet retry should upgrade an unclear label", file=sys.stderr)
            return 2

        class CacheProbe:
            def __init__(self) -> None:
                self.calls = 0

            def generate(self, prompt: str, response_format: str | None = None) -> str:
                self.calls += 1
                return json.dumps(
                    {
                        "name": "Cached Mystery",
                        "category": "feature",
                        "description": "From cache path",
                        "entry_points": ["/mystery"],
                        "evidence_files": ["app/mystery/page.tsx"],
                        "needs_split": False,
                        "confidence": "high",
                    }
                )

        cache_path = Path(tmp) / "repeat.json"
        probe = CacheProbe()
        attach_cluster_labels(
            [unclear_cluster],
            {"nodes": [{"id": "app/mystery/page.tsx", "role": "page"}], "edges": []},
            unclear_files,
            label_with_llm=True,
            llm_client=probe,
            cache=LabelCache(cache_path),
        )
        first_calls = probe.calls
        probe.calls = 0
        cached = attach_cluster_labels(
            [unclear_cluster],
            {"nodes": [{"id": "app/mystery/page.tsx", "role": "page"}], "edges": []},
            unclear_files,
            label_with_llm=True,
            llm_client=probe,
            cache=LabelCache(cache_path),
        )
        if probe.calls != 0 or cached[0]["name"] != "Cached Mystery":
            print("unchanged fingerprints should reuse the cached label", file=sys.stderr)
            return 2
        if first_calls < 1:
            print("cache miss should call the model once first", file=sys.stderr)
            return 2

    print(json.dumps({"ok": True, "selfTest": True, "label": labeled}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
