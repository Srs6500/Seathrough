"""Persist discovered features plus the evidence needed to query them later.

The catalog is not just AI names. It keeps primary files, shared
dependencies, and a file → feature index so a change to lib/auth.ts
can resolve to the features that rely on it.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from typing import Any

from file_graph import route_for_path

GENERIC_RELATED = {
    "button",
    "form",
    "navbar",
    "cn",
    "separator",
    "badge",
    "input",
    "label",
    "tabs",
}
ID_ALIASES = {
    "auth": "authentication",
    "payments": "payments",
}
VERIFICATION_STATUS = "not_tested"


def _clean(path: Any) -> str:
    return str(path or "").replace("\\", "/").lstrip("./").strip()


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "feature"


def _stem(path: str) -> str:
    return path.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()


def feature_id_for(cluster: dict[str, Any], used: set[str]) -> str:
    label = str(cluster.get("label") or "").strip()
    name = str(cluster.get("name") or "").strip()
    base = ID_ALIASES.get(label) or (_slug(label) if label else "") or _slug(name)
    if cluster.get("source") == "shared" and label:
        base = f"shared-{_slug(label)}"
    candidate = base or _slug(str(cluster.get("cluster_id") or "feature"))
    if candidate not in used:
        used.add(candidate)
        return candidate
    index = 2
    while f"{candidate}-{index}" in used:
        index += 1
    unique = f"{candidate}-{index}"
    used.add(unique)
    return unique


def empty_catalog() -> dict[str, Any]:
    return {
        "features": [],
        "infrastructure": [],
        "graph": {"nodes": [], "edges": []},
        "file_index": {},
        "repo_checks": [],
    }


def _entry_points(cluster: dict[str, Any]) -> list[str]:
    routes = [
        str(item).strip()
        for item in cluster.get("entry_points") or []
        if str(item).strip()
    ]
    if routes:
        return routes[:8]
    inferred: list[str] = []
    for path in cluster.get("entries") or []:
        route = route_for_path(_clean(path))
        if route and route not in inferred:
            inferred.append(route)
    return inferred[:8]


def _relationships(cluster: dict[str, Any]) -> list[str]:
    summary = cluster.get("summary") if isinstance(cluster.get("summary"), dict) else {}
    return [
        str(item)
        for item in (summary.get("relationships") or [])
        if str(item).strip()
    ]


def _record(cluster: dict[str, Any], feature_id: str) -> dict[str, Any]:
    primary = [_clean(path) for path in cluster.get("files") or [] if _clean(path)]
    shared = [
        _clean(path)
        for path in cluster.get("shared_files") or []
        if _clean(path) and _clean(path) not in primary
    ]
    return {
        "feature_id": feature_id,
        "name": str(cluster.get("name") or cluster.get("label") or feature_id),
        "description": str(cluster.get("description") or "").strip(),
        "entry_points": _entry_points(cluster),
        "primary_files": primary,
        "shared_dependencies": shared,
        "related_features": [],
        "verification_status": VERIFICATION_STATUS,
        "evidence": {
            "cluster_id": cluster.get("cluster_id"),
            "source": cluster.get("source"),
            "category": cluster.get("category"),
            "confidence": cluster.get("confidence"),
            "labeled_by": cluster.get("labeled_by"),
            "relationships": _relationships(cluster),
            "entries": [_clean(path) for path in cluster.get("entries") or [] if _clean(path)],
        },
    }


def _link_related(records: list[dict[str, Any]], graph: dict[str, Any]) -> None:
    by_id = {item["feature_id"]: item for item in records}
    file_owners: dict[str, set[str]] = defaultdict(set)
    for item in records:
        for path in item["primary_files"]:
            file_owners[path].add(item["feature_id"])
        for path in item["shared_dependencies"]:
            if _stem(path) in GENERIC_RELATED:
                continue
            file_owners[path].add(item["feature_id"])

    related: dict[str, set[str]] = defaultdict(set)
    for owners in file_owners.values():
        if len(owners) < 2:
            continue
        for left in owners:
            related[left].update(other for other in owners if other != left)

    primary_index = {
        path: item["feature_id"]
        for item in records
        for path in item["primary_files"]
    }
    for edge in graph.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        source = _clean(edge.get("source"))
        target = _clean(edge.get("target"))
        left = primary_index.get(source)
        right = primary_index.get(target)
        if left and right and left != right:
            related[left].add(right)
            related[right].add(left)

    for feature_id, others in related.items():
        by_id[feature_id]["related_features"] = sorted(others)


def _file_index(records: list[dict[str, Any]]) -> dict[str, dict[str, list[str]]]:
    index: dict[str, dict[str, set[str]]] = defaultdict(lambda: {"primary": set(), "shared": set()})
    for item in records:
        feature_id = item["feature_id"]
        for path in item["primary_files"]:
            index[path]["primary"].add(feature_id)
        for path in item["shared_dependencies"]:
            index[path]["shared"].add(feature_id)
    return {
        path: {
            "primary": sorted(slots["primary"]),
            "shared": sorted(slots["shared"]),
        }
        for path, slots in sorted(index.items())
    }


def build_feature_catalog(
    clusters: list[dict[str, Any]] | None,
    repo_graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    graph = repo_graph if isinstance(repo_graph, dict) else {}
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []
    if not clusters:
        return {
            "features": [],
            "infrastructure": [],
            "graph": {"nodes": nodes, "edges": edges},
            "file_index": {},
        }

    used: set[str] = set()
    features: list[dict[str, Any]] = []
    infrastructure: list[dict[str, Any]] = []
    for cluster in clusters:
        if not isinstance(cluster, dict):
            continue
        feature_id = feature_id_for(cluster, used)
        record = _record(cluster, feature_id)
        if cluster.get("source") == "shared" or cluster.get("category") == "infrastructure":
            infrastructure.append(record)
        else:
            features.append(record)

    _link_related(features, {"nodes": nodes, "edges": edges})
    return {
        "features": features,
        "infrastructure": infrastructure,
        "graph": {"nodes": nodes, "edges": edges},
        "file_index": _file_index(features + infrastructure),
    }


def features_for_file(catalog: dict[str, Any] | None, path: str) -> dict[str, Any]:
    """Which stored features rely on this file?"""
    cleaned = _clean(path)
    empty = {"path": cleaned, "primary": [], "shared": []}
    if not isinstance(catalog, dict) or not cleaned:
        return empty
    slot = (catalog.get("file_index") or {}).get(cleaned) or {}
    by_id = {
        item["feature_id"]: item
        for item in (catalog.get("features") or []) + (catalog.get("infrastructure") or [])
        if isinstance(item, dict) and item.get("feature_id")
    }
    return {
        "path": cleaned,
        "primary": [by_id[item] for item in slot.get("primary") or [] if item in by_id],
        "shared": [by_id[item] for item in slot.get("shared") or [] if item in by_id],
    }


def self_test() -> int:
    empty = build_feature_catalog([], {"nodes": [], "edges": []})
    if empty["features"] != [] or empty["file_index"] != {}:
        print("empty clusters should yield an empty catalog", file=sys.stderr)
        return 2
    if features_for_file(empty, "lib/auth.ts")["primary"]:
        print("empty catalog should not map files to features", file=sys.stderr)
        return 2
    if build_feature_catalog(None)["features"] != []:
        print("invalid clusters should yield an empty catalog", file=sys.stderr)
        return 2

    clusters = [
        {
            "cluster_id": "cluster_0",
            "source": "route",
            "label": "auth",
            "name": "User Authentication",
            "description": "Login and account access",
            "category": "feature",
            "entries": ["app/login/page.tsx", "app/signup/page.tsx"],
            "entry_points": ["/login", "/signup"],
            "files": [
                "app/login/page.tsx",
                "app/signup/page.tsx",
                "lib/auth.ts",
            ],
            "shared_files": ["lib/database.ts"],
            "summary": {
                "relationships": [
                    "LoginPage calls signIn",
                    "SignupPage calls signUp",
                ]
            },
        },
        {
            "cluster_id": "cluster_1",
            "source": "route",
            "label": "dashboard",
            "name": "Dashboard",
            "description": "Account overview",
            "category": "feature",
            "entries": ["app/dashboard/page.tsx"],
            "entry_points": ["/dashboard"],
            "files": ["app/dashboard/page.tsx", "components/Navbar.tsx"],
            "shared_files": ["lib/database.ts", "components/Button.tsx"],
        },
    ]
    catalog = build_feature_catalog(
        clusters,
        {
            "nodes": [
                {"id": "app/login/page.tsx", "role": "page"},
                {"id": "lib/auth.ts", "role": "service"},
                {"id": "lib/database.ts", "role": "service"},
            ],
            "edges": [
                {"source": "lib/auth.ts", "target": "lib/database.ts", "type": "calls"},
            ],
        },
    )
    auth = next(item for item in catalog["features"] if item["feature_id"] == "authentication")
    if auth["entry_points"] != ["/login", "/signup"]:
        print(f"auth entry points were {auth['entry_points']}", file=sys.stderr)
        return 2
    if auth["primary_files"] != [
        "app/login/page.tsx",
        "app/signup/page.tsx",
        "lib/auth.ts",
    ]:
        print(f"auth primary files were {auth['primary_files']}", file=sys.stderr)
        return 2
    if auth["shared_dependencies"] != ["lib/database.ts"]:
        print(f"auth shared deps were {auth['shared_dependencies']}", file=sys.stderr)
        return 2
    if auth["verification_status"] != "not_tested":
        print("new features should start as not_tested", file=sys.stderr)
        return 2
    if "dashboard" not in auth["related_features"]:
        print("auth should relate to dashboard via database.ts", file=sys.stderr)
        return 2
    if "LoginPage calls signIn" not in auth["evidence"]["relationships"]:
        print("catalog must keep relationship evidence", file=sys.stderr)
        return 2

    hit = features_for_file(catalog, "lib/auth.ts")
    if [item["feature_id"] for item in hit["primary"]] != ["authentication"]:
        print(f"lib/auth.ts should resolve to authentication, got {hit}", file=sys.stderr)
        return 2
    db = features_for_file(catalog, "lib/database.ts")
    db_ids = sorted(item["feature_id"] for item in db["shared"])
    if "authentication" not in db_ids or "dashboard" not in db_ids:
        print(f"database.ts should be a shared dependency, got {db_ids}", file=sys.stderr)
        return 2
    if features_for_file(catalog, "missing.ts")["primary"] or features_for_file(catalog, "")["primary"]:
        print("missing files should not invent dependents", file=sys.stderr)
        return 2

    print(json.dumps({"ok": True, "selfTest": True, "feature": auth}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
