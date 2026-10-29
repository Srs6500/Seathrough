"""Route-seeded feature discovery.

One cluster is not one feature. Shared Button / database nodes must not
merge login, signup, dashboard, and checkout. Start at entry points, walk
verified dependency edges a bounded depth, mark reused infrastructure as
shared, then group related routes (login + signup) with evidence.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from typing import Any

from file_graph import (
    classify_role,
    feature_key,
    is_entry_path,
    is_shared_path,
    route_for_path,
    shared_kind,
)

try:
    import networkx as nx
except ImportError:  # pragma: no cover - optional until requirements are installed
    nx = None  # type: ignore[assignment]

EDGE_WEIGHTS = {
    "renders": 5.0,
    "calls": 3.0,
    "requests": 3.0,
    "imports": 1.0,
    "same_directory": 0.5,
}
ROUTE_EDGE_TYPES = frozenset({"renders", "calls", "requests"})
MAX_DEPTH = 4
AUTH_HINTS = (
    "login",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "register",
    "logout",
    "signout",
    "sign-out",
    "mfa",
    "auth",
)
PAY_HINTS = ("checkout", "payment", "billing", "stripe", "cart")
FAMILY_CONFLICTS = {frozenset({"auth", "payments"})}
LOUVAIN_RESOLUTION = 1.2
LOUVAIN_SEED = 0
SOURCE_ORDER = {"route": 0, "shared": 1, "louvain": 2}


def _as_graph(repo_graph: Any) -> dict[str, Any]:
    if not isinstance(repo_graph, dict):
        return {"nodes": [], "edges": []}
    nodes = repo_graph.get("nodes")
    edges = repo_graph.get("edges")
    return {
        "nodes": nodes if isinstance(nodes, list) else [],
        "edges": edges if isinstance(edges, list) else [],
    }


def _node_id(node: Any) -> str | None:
    if not isinstance(node, dict):
        return None
    node_id = str(node.get("id") or "").strip()
    return node_id or None


def _parent_dir(path: str) -> str:
    if "/" not in path:
        return ""
    return path.rsplit("/", 1)[0]


def _roles(repo_graph: dict[str, Any]) -> dict[str, str]:
    roles: dict[str, str] = {}
    for node in repo_graph["nodes"]:
        node_id = _node_id(node)
        if not node_id:
            continue
        role = node.get("role")
        if role in {"page", "api_route", "component", "service"}:
            roles[node_id] = str(role)
            continue
        inferred = classify_role(node_id)
        if inferred:
            roles[node_id] = inferred
    return roles


def entry_family(path: str) -> str:
    folder = feature_key(path)
    if folder:
        return folder
    blob = f"{route_for_path(path) or ''} {path}".lower()
    if any(hint in blob for hint in AUTH_HINTS):
        return "auth"
    if any(hint in blob for hint in PAY_HINTS):
        return "payments"
    route = route_for_path(path)
    if route:
        return route.strip("/").split("/")[0] or "home"
    return path.rsplit("/", 1)[-1]


def build_directed_graph(repo_graph: dict[str, Any]) -> Any:
    """Directed file graph for route-seeded traversal."""
    data = _as_graph(repo_graph)
    roles = _roles(data)
    if nx is None:
        raise RuntimeError(
            'networkx is not installed. Run: python3 -m pip install "networkx>=3.2"'
        )
    graph = nx.DiGraph()
    for node_id, role in roles.items():
        graph.add_node(node_id, role=role, id=node_id)
    for node in data["nodes"]:
        node_id = _node_id(node)
        if node_id and node_id not in graph:
            graph.add_node(node_id, **{k: v for k, v in node.items() if k != "id"})

    for edge in data["edges"]:
        if not isinstance(edge, dict):
            continue
        source = str(edge.get("source") or "").strip()
        target = str(edge.get("target") or "").strip()
        edge_type = str(edge.get("type") or "").strip()
        if not source or not target or source == target:
            continue
        if source not in graph or target not in graph:
            continue
        weight = float(EDGE_WEIGHTS.get(edge_type, 1.0))
        if graph.has_edge(source, target):
            previous = graph[source][target]
            previous["weight"] = float(previous.get("weight") or 0) + weight
            types = set(previous.get("types") or [])
            types.add(edge_type)
            previous["types"] = types
            if weight >= float(EDGE_WEIGHTS.get(str(previous.get("type") or ""), 0)):
                previous["type"] = edge_type
        else:
            graph.add_edge(source, target, type=edge_type, types={edge_type}, weight=weight)
    return graph


def _successors(graph: Any, current: str) -> list[str]:
    if hasattr(graph, "successors"):
        return list(graph.successors(current))
    return []


def _edge_types(graph: Any, source: str, target: str) -> set[str]:
    edge = graph[source][target]
    types = edge.get("types")
    if isinstance(types, set) and types:
        return {str(item) for item in types}
    if isinstance(types, list) and types:
        return {str(item) for item in types}
    return {str(edge.get("type") or "")}


def route_feature_candidates(graph: Any) -> list[dict[str, Any]]:
    """
    graph nodes:
        role = page | api_route | component | service

    graph edges:
        type = renders | calls | requests | imports
    """
    entry_points = [
        node
        for node, attrs in graph.nodes(data=True)
        if attrs.get("role") in {"page", "api_route"} or is_entry_path(str(node))
    ]
    entry_points = sorted(set(entry_points))
    candidates = []
    for entry in entry_points:
        visited = {entry}
        frontier = [(entry, 0)]
        while frontier:
            current, depth = frontier.pop(0)
            if depth >= MAX_DEPTH:
                continue
            for next_node in _successors(graph, current):
                if _edge_types(graph, current, next_node).isdisjoint(ROUTE_EDGE_TYPES):
                    continue
                if next_node not in visited:
                    visited.add(next_node)
                    frontier.append((next_node, depth + 1))
        candidates.append({"entry_point": entry, "files": sorted(visited)})
    # A file can belong to multiple feature candidates.
    # Don't force a single ownership assignment.
    return candidates


def detect_shared_files(
    candidates: list[dict[str, Any]],
    graph: Any,
) -> set[str]:
    owners: dict[str, set[str]] = defaultdict(set)
    for item in candidates:
        entry = str(item["entry_point"])
        for path in item.get("files") or []:
            owners[str(path)].add(entry)

    entry_count = max(1, len(candidates))
    shared: set[str] = set()
    for path, entries in owners.items():
        if is_shared_path(path):
            shared.add(path)
            continue
        families = {entry_family(entry) for entry in entries}
        if len(families) >= 2:
            shared.add(path)
            continue
        if len(entries) >= 3 or len(entries) >= max(3, (entry_count + 1) // 2):
            shared.add(path)
            continue
        try:
            degree = int(graph.in_degree(path))  # type: ignore[arg-type]
        except Exception:
            degree = 0
        if degree >= 4 and len(entries) >= 2:
            shared.add(path)
    return shared


def families_compatible(left: str, right: str) -> bool:
    if left == right:
        return True
    return frozenset({left, right}) not in FAMILY_CONFLICTS


def group_related_entries(
    candidates: list[dict[str, Any]],
    shared: set[str],
) -> list[dict[str, Any]]:
    """Login / signup / logout become one Authentication feature."""
    buckets: dict[str, dict[str, Any]] = {}
    for item in candidates:
        entry = str(item["entry_point"])
        family = entry_family(entry)
        bucket = buckets.setdefault(
            family,
            {
                "family": family,
                "entries": [],
                "reached": set(),
            },
        )
        bucket["entries"].append(entry)
        bucket["reached"].update(str(path) for path in item.get("files") or [])

    grouped: list[dict[str, Any]] = []
    for family in sorted(buckets):
        bucket = buckets[family]
        entries = sorted(set(bucket["entries"]))
        reached = set(bucket["reached"])
        core = sorted(
            path for path in reached if path not in shared or path in entries
        )
        shared_files = sorted(path for path in reached if path in shared and path not in entries)
        grouped.append(
            {
                "files": core,
                "shared_files": shared_files,
                "entries": entries,
                "source": "route",
                "label": family,
            }
        )
    return grouped


def build_weighted_graph(repo_graph: dict[str, Any], keep: set[str] | None = None) -> Any:
    if nx is None:
        raise RuntimeError(
            'networkx is not installed. Run: python3 -m pip install "networkx>=3.2"'
        )
    graph = nx.Graph()
    data = _as_graph(repo_graph)
    for node in data["nodes"]:
        node_id = _node_id(node)
        if not node_id:
            continue
        if keep is not None and node_id not in keep:
            continue
        graph.add_node(node_id, **{k: v for k, v in node.items() if k != "id"})
    for edge in data["edges"]:
        if not isinstance(edge, dict):
            continue
        source = str(edge.get("source") or "").strip()
        target = str(edge.get("target") or "").strip()
        if not source or not target or source == target:
            continue
        if source not in graph or target not in graph:
            continue
        weight = float(EDGE_WEIGHTS.get(str(edge.get("type") or ""), 1.0))
        if graph.has_edge(source, target):
            graph[source][target]["weight"] += weight
        else:
            graph.add_edge(source, target, weight=weight)
    by_dir: dict[str, list[str]] = defaultdict(list)
    for node_id in graph.nodes:
        by_dir[_parent_dir(str(node_id))].append(str(node_id))
    same_dir_weight = EDGE_WEIGHTS["same_directory"]
    for paths in by_dir.values():
        if len(paths) < 2:
            continue
        for index, source in enumerate(paths):
            for target in paths[index + 1 :]:
                if graph.has_edge(source, target):
                    graph[source][target]["weight"] += same_dir_weight
                else:
                    graph.add_edge(source, target, weight=same_dir_weight)
    return graph


def louvain_clusters(repo_graph: dict[str, Any], leftover: set[str]) -> list[list[str]]:
    leftover = {node for node in leftover if node and not is_shared_path(node)}
    if not leftover:
        return []
    if nx is None:
        return [sorted(leftover)]
    graph = build_weighted_graph(repo_graph, leftover)
    keep = [node for node in leftover if graph.has_node(node)]
    if not keep:
        return [sorted(leftover)] if leftover else []
    subgraph = graph.subgraph(keep).copy()
    if subgraph.number_of_nodes() <= 1:
        return [sorted(keep)] if keep else []
    communities = nx.community.louvain_communities(
        subgraph,
        weight="weight",
        resolution=LOUVAIN_RESOLUTION,
        seed=LOUVAIN_SEED,
    )
    clusters = [sorted(community) for community in communities if community]
    clusters.sort(key=lambda files: files[0] if files else "")
    return clusters


def discover_clusters(repo_graph: Any) -> list[dict[str, Any]]:
    data = _as_graph(repo_graph)
    node_ids = {node_id for node in data["nodes"] if (node_id := _node_id(node))}
    if not node_ids:
        return []
    if nx is None:
        return []

    graph = build_directed_graph(data)
    raw = route_feature_candidates(graph)
    shared = detect_shared_files(raw, graph)
    grouped = group_related_entries(raw, shared)

    assigned: set[str] = set()
    for item in grouped:
        assigned.update(item["files"])
        assigned.update(item.get("shared_files") or [])

    for node_id in node_ids:
        if node_id in assigned or is_shared_path(node_id):
            continue
        folder = feature_key(node_id)
        if not folder:
            continue
        for item in grouped:
            if item.get("label") == folder:
                item["files"] = sorted(set(item["files"]) | {node_id})
                assigned.add(node_id)
                break

    shared_leftover = [
        node_id
        for node_id in node_ids
        if node_id not in {path for item in grouped for path in item["files"]}
        and (node_id in shared or is_shared_path(node_id))
    ]
    if shared_leftover:
        by_kind: dict[str, list[str]] = defaultdict(list)
        for path in shared_leftover:
            by_kind[shared_kind(path)].append(path)
        for kind in sorted(by_kind):
            grouped.append(
                {
                    "files": sorted(by_kind[kind]),
                    "shared_files": [],
                    "entries": [],
                    "source": "shared",
                    "label": kind,
                }
            )
            assigned.update(by_kind[kind])

    leftover = {node_id for node_id in node_ids if node_id not in assigned}
    for files in louvain_clusters(data, leftover):
        grouped.append(
            {
                "files": files,
                "shared_files": [],
                "entries": [],
                "source": "louvain",
                "label": files[0] if files else "leftover",
            }
        )

    grouped.sort(
        key=lambda item: (
            SOURCE_ORDER.get(str(item.get("source") or ""), 9),
            str(item.get("label") or ""),
            item["files"][0] if item.get("files") else "",
        )
    )
    labeled: list[dict[str, Any]] = []
    for item in grouped:
        labeled.append(
            {
                "cluster_id": f"cluster_{len(labeled)}",
                "files": item["files"],
                "shared_files": item.get("shared_files") or [],
                "entries": item.get("entries") or [],
                "source": item["source"],
                **({"label": item["label"]} if item.get("label") else {}),
            }
        )
    return labeled


def self_test() -> int:
    if classify_role("web/src/features/auth/LoginPage.tsx") != "page":
        print("named feature page should be a page", file=sys.stderr)
        return 2
    if classify_role("app/api/checkout/route.ts") != "api_route":
        print("App Router route.ts should be an api_route entry", file=sys.stderr)
        return 2
    if classify_role("web/src/shared/layout/TabbedPage.tsx") == "page":
        print("shared *Page helper should not be a route", file=sys.stderr)
        return 2
    if not is_shared_path("web/src/components/ui/button.tsx"):
        print("design-system files should be shared", file=sys.stderr)
        return 2
    if feature_key("web/src/features/order-management/OrdersPage.tsx") != "order-management":
        print("feature folder key should use the first features/ segment", file=sys.stderr)
        return 2
    if entry_family("app/login/page.tsx") != "auth" or entry_family("app/signup/page.tsx") != "auth":
        print("login and signup should share the auth family", file=sys.stderr)
        return 2
    if entry_family("app/checkout/page.tsx") != "payments":
        print("checkout should be a payments family", file=sys.stderr)
        return 2

    empty = discover_clusters({"nodes": [], "edges": []})
    if empty != []:
        print("empty graph should yield no clusters", file=sys.stderr)
        return 2
    if discover_clusters({}) != [] or discover_clusters(None) != []:
        print("invalid graph should yield no clusters", file=sys.stderr)
        return 2

    example = {
        "nodes": [
            {"id": "app/login/page.tsx", "role": "page"},
            {"id": "components/LoginForm.tsx", "role": "component"},
            {"id": "lib/auth.ts", "role": "service"},
            {"id": "app/dashboard/page.tsx", "role": "page"},
            {"id": "components/Stats.tsx", "role": "component"},
            {"id": "lib/db.ts", "role": "service"},
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
            {
                "source": "app/dashboard/page.tsx",
                "target": "components/Stats.tsx",
                "type": "renders",
            },
            {
                "source": "components/Stats.tsx",
                "target": "lib/db.ts",
                "type": "calls",
            },
        ],
    }
    clusters = discover_clusters(example)
    groups = {frozenset(item["files"]) for item in clusters}
    expected = {
        frozenset(
            [
                "app/login/page.tsx",
                "components/LoginForm.tsx",
                "lib/auth.ts",
            ]
        ),
        frozenset(
            [
                "app/dashboard/page.tsx",
                "components/Stats.tsx",
                "lib/db.ts",
            ]
        ),
    }
    if groups != expected:
        print(f"example clusters were {groups}", file=sys.stderr)
        return 2

    shared = {
        "nodes": example["nodes"] + [{"id": "lib/cn.ts", "role": "service"}],
        "edges": example["edges"]
        + [
            {
                "source": "components/LoginForm.tsx",
                "target": "lib/cn.ts",
                "type": "calls",
            },
            {
                "source": "components/Stats.tsx",
                "target": "lib/cn.ts",
                "type": "calls",
            },
        ],
    }
    shared_clusters = discover_clusters(shared)
    owned = {
        frozenset(item["files"])
        for item in shared_clusters
        if item.get("source") != "shared"
    }
    if expected - owned:
        print("shared utility should not merge route clusters", file=sys.stderr)
        return 2
    if not any("lib/cn.ts" in (item.get("shared_files") or item.get("files") or []) for item in shared_clusters):
        print("shared utility should still be listed", file=sys.stderr)
        return 2
    if any("lib/cn.ts" in item["files"] and item.get("source") == "route" for item in shared_clusters):
        print("cn.ts must not be exclusive to one feature", file=sys.stderr)
        return 2

    seeded = {
        "nodes": [
            {"id": "app/login/page.tsx", "role": "page"},
            {"id": "app/signup/page.tsx", "role": "page"},
            {"id": "app/dashboard/page.tsx", "role": "page"},
            {"id": "app/checkout/page.tsx", "role": "page"},
            {"id": "components/Button.tsx", "role": "component"},
            {"id": "components/Form.tsx", "role": "component"},
            {"id": "components/Navbar.tsx", "role": "component"},
            {"id": "lib/auth.ts", "role": "service"},
            {"id": "lib/stripe.ts", "role": "service"},
            {"id": "lib/database.ts", "role": "service"},
        ],
        "edges": [
            {"source": "app/login/page.tsx", "target": "components/Form.tsx", "type": "renders"},
            {"source": "app/login/page.tsx", "target": "components/Button.tsx", "type": "renders"},
            {"source": "app/login/page.tsx", "target": "lib/auth.ts", "type": "calls"},
            {"source": "app/signup/page.tsx", "target": "components/Form.tsx", "type": "renders"},
            {"source": "app/signup/page.tsx", "target": "components/Button.tsx", "type": "renders"},
            {"source": "app/signup/page.tsx", "target": "lib/auth.ts", "type": "calls"},
            {"source": "app/dashboard/page.tsx", "target": "components/Navbar.tsx", "type": "renders"},
            {"source": "app/dashboard/page.tsx", "target": "components/Button.tsx", "type": "renders"},
            {"source": "app/dashboard/page.tsx", "target": "lib/database.ts", "type": "calls"},
            {"source": "app/checkout/page.tsx", "target": "components/Form.tsx", "type": "renders"},
            {"source": "app/checkout/page.tsx", "target": "components/Button.tsx", "type": "renders"},
            {"source": "app/checkout/page.tsx", "target": "lib/stripe.ts", "type": "calls"},
            {"source": "lib/auth.ts", "target": "lib/database.ts", "type": "calls"},
            {"source": "lib/stripe.ts", "target": "lib/database.ts", "type": "calls"},
        ],
    }
    seeded_clusters = discover_clusters(seeded)
    by_label = {item.get("label"): item for item in seeded_clusters}
    auth = by_label.get("auth") or {}
    dashboard = by_label.get("dashboard") or {}
    payments = by_label.get("payments") or {}
    if set(auth.get("entries") or []) != {"app/login/page.tsx", "app/signup/page.tsx"}:
        print(f"auth entries were {auth.get('entries')}", file=sys.stderr)
        return 2
    if "lib/auth.ts" not in auth.get("files", []):
        print("auth.ts should stay with authentication", file=sys.stderr)
        return 2
    if "lib/stripe.ts" in auth.get("files", []) or "app/checkout/page.tsx" in auth.get("files", []):
        print("checkout must not merge into authentication", file=sys.stderr)
        return 2
    if "components/Button.tsx" in auth.get("files", []) or "lib/database.ts" in auth.get("files", []):
        print("shared Button/database must not be exclusive auth files", file=sys.stderr)
        return 2
    if "lib/stripe.ts" not in payments.get("files", []):
        print("stripe should stay with checkout", file=sys.stderr)
        return 2
    if "components/Navbar.tsx" not in dashboard.get("files", []):
        print("navbar should stay with dashboard", file=sys.stderr)
        return 2
    shared_hits = set(auth.get("shared_files") or []) | set(payments.get("shared_files") or [])
    if "components/Button.tsx" not in shared_hits or "lib/database.ts" not in shared_hits:
        print("Button and database should be marked shared", file=sys.stderr)
        return 2

    vite = {
        "nodes": [
            {"id": "web/src/main.tsx", "role": "component"},
            {"id": "web/src/app/App.tsx", "role": "component"},
            {"id": "web/src/app/router.tsx", "role": "component"},
            {"id": "web/src/shared/layout/AppShell.tsx", "role": "component"},
            {"id": "web/src/shared/lib/AuthContext.tsx", "role": "component"},
            {"id": "web/src/components/ui/button.tsx", "role": "component"},
            {"id": "web/src/features/auth/LoginPage.tsx", "role": "page"},
            {"id": "web/src/features/auth/AuthBackground.tsx", "role": "component"},
            {"id": "web/src/features/terminal/TradePage.tsx", "role": "page"},
            {"id": "web/src/features/terminal/OrderTicket.tsx", "role": "component"},
        ],
        "edges": [
            {"source": "web/src/main.tsx", "target": "web/src/app/App.tsx", "type": "renders"},
            {"source": "web/src/app/App.tsx", "target": "web/src/app/router.tsx", "type": "renders"},
            {
                "source": "web/src/app/router.tsx",
                "target": "web/src/features/auth/LoginPage.tsx",
                "type": "renders",
            },
            {
                "source": "web/src/app/router.tsx",
                "target": "web/src/features/terminal/TradePage.tsx",
                "type": "renders",
            },
            {
                "source": "web/src/app/router.tsx",
                "target": "web/src/shared/layout/AppShell.tsx",
                "type": "renders",
            },
            {
                "source": "web/src/features/auth/LoginPage.tsx",
                "target": "web/src/features/auth/AuthBackground.tsx",
                "type": "renders",
            },
            {
                "source": "web/src/features/auth/LoginPage.tsx",
                "target": "web/src/components/ui/button.tsx",
                "type": "renders",
            },
            {
                "source": "web/src/features/auth/LoginPage.tsx",
                "target": "web/src/shared/lib/AuthContext.tsx",
                "type": "renders",
            },
            {
                "source": "web/src/features/terminal/TradePage.tsx",
                "target": "web/src/features/terminal/OrderTicket.tsx",
                "type": "renders",
            },
            {
                "source": "web/src/features/terminal/TradePage.tsx",
                "target": "web/src/components/ui/button.tsx",
                "type": "renders",
            },
            {
                "source": "web/src/features/terminal/TradePage.tsx",
                "target": "web/src/shared/lib/AuthContext.tsx",
                "type": "renders",
            },
        ],
    }
    vite_clusters = discover_clusters(vite)
    by_label = {item.get("label"): set(item["files"]) for item in vite_clusters}
    auth_files = {
        "web/src/features/auth/LoginPage.tsx",
        "web/src/features/auth/AuthBackground.tsx",
    }
    terminal_files = {
        "web/src/features/terminal/TradePage.tsx",
        "web/src/features/terminal/OrderTicket.tsx",
    }
    if by_label.get("auth") != auth_files:
        print(f"auth feature cluster was {by_label.get('auth')}", file=sys.stderr)
        return 2
    if by_label.get("terminal") != terminal_files:
        print(f"terminal feature cluster was {by_label.get('terminal')}", file=sys.stderr)
        return 2
    if "web/src/components/ui/button.tsx" in by_label.get("auth", set()):
        print("design-system files must not join a feature cluster", file=sys.stderr)
        return 2

    print(json.dumps({"ok": True, "selfTest": True, "clusters": clusters}))
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else 0)
