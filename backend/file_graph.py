"""File relationship graph from tree-sitter usage facts + framework path rules."""

from __future__ import annotations

import re
from typing import Any

ROLE_ORDER = {"page": 0, "api_route": 1, "component": 2, "service": 3}

PAGE_APP = re.compile(r"(^|/)app/(?:.+/)?page\.(tsx|jsx|ts|js)$")
PAGE_PAGES = re.compile(r"(^|/)pages/(?!api/).+\.(tsx|jsx|ts|js)$")
PAGE_VITE = re.compile(r"(^|/)src/pages/.+\.(tsx|jsx)$")
PAGE_NAMED = re.compile(r"(^|/)[A-Z][A-Za-z0-9]*Page\.(tsx|jsx)$")
API_APP = re.compile(r"(^|/)app/.+/route\.(ts|js)$")
API_PAGES = re.compile(r"(^|/)pages/api/")
SERVICE_DIR = re.compile(r"(^|/)(lib|utils|services|server|api)/")
DB_FILE = re.compile(r"(^|/)(db|database|prisma|supabase)\.(ts|js)$")
COMPONENT_DIR = re.compile(r"(^|/)(components|ui|features)/")
FEATURE_DIR = re.compile(r"(^|/)features/([^/]+)/")
SHARED_DIR = re.compile(r"(^|/)(components/ui|shared|src/ui)/")
HANDLER_FILE = re.compile(r"(^|/)(middleware|instrumentation)\.(ts|js)$")
WEBHOOK_DIR = re.compile(r"(^|/)(webhook|webhooks)/")
NAMED_HANDLER = re.compile(
    r"(^|/)[A-Za-z][A-Za-z0-9]*(Handler|Listener|Consumer)\.(ts|js)$"
)


def normalize_path(path: str) -> str:
    return path.replace("\\", "/").lstrip("./")


def is_hub_path(path: str) -> bool:
    cleaned = normalize_path(path)
    name = cleaned.rsplit("/", 1)[-1]
    if name in {"main.tsx", "main.jsx", "main.ts", "main.js"}:
        return True
    if name in {"App.tsx", "App.jsx", "router.tsx", "router.jsx"}:
        return "/features/" not in f"/{cleaned}"
    return False


def is_shared_path(path: str) -> bool:
    cleaned = normalize_path(path)
    if is_hub_path(cleaned):
        return True
    return bool(SHARED_DIR.search(cleaned))


def feature_key(path: str) -> str | None:
    match = FEATURE_DIR.search(normalize_path(path))
    if not match:
        return None
    return match.group(2)


def shared_kind(path: str) -> str:
    cleaned = normalize_path(path)
    if is_hub_path(cleaned):
        return "shell"
    if re.search(r"(^|/)(components/ui|src/ui)/", cleaned):
        return "ui"
    if re.search(r"(^|/)shared/layout/", cleaned):
        return "layout"
    if re.search(r"(^|/)shared/", cleaned):
        return "lib"
    return "shared"


def _route_segments(raw: str) -> list[str]:
    parts: list[str] = []
    for segment in raw.split("/"):
        if not segment or segment.startswith("(") or segment.startswith("@"):
            continue
        if segment.startswith("["):
            parts.append(":" + re.sub(r"[\[\]\.]", "", segment))
            continue
        parts.append(segment)
    return parts


def route_for_path(path: str) -> str | None:
    """User-facing route guessed from framework path conventions."""
    cleaned = normalize_path(path)
    app_page = re.search(r"(?:^|/)app/(.+)/page\.(tsx|jsx|ts|js)$", cleaned)
    if app_page:
        segments = _route_segments(app_page.group(1))
        return "/" + "/".join(segments) if segments else "/"
    if re.search(r"(?:^|/)app/page\.(tsx|jsx|ts|js)$", cleaned):
        return "/"
    app_route = re.search(r"(?:^|/)app/(.+)/route\.(ts|js)$", cleaned)
    if app_route:
        segments = [part for part in _route_segments(app_route.group(1)) if part != "api"]
        return "/api/" + "/".join(segments)
    pages_api = re.search(r"(?:^|/)pages/api/(.+)\.(ts|js)$", cleaned)
    if pages_api:
        return "/api/" + pages_api.group(1).replace("/index", "")
    pages_page = re.search(r"(?:^|/)pages/(.+)\.(tsx|jsx|ts|js)$", cleaned)
    if pages_page:
        rest = pages_page.group(1)
        if rest.startswith("api/"):
            return None
        if rest == "index":
            return "/"
        return "/" + rest.replace("/index", "")
    vite_page = re.search(r"(?:^|/)src/pages/(.+)\.(tsx|jsx)$", cleaned)
    if vite_page:
        rest = vite_page.group(1)
        if rest == "index":
            return "/"
        return "/" + rest.replace("/index", "")
    if is_shared_path(cleaned):
        return None
    named = re.search(r"(?:^|/)([A-Z][A-Za-z0-9]*)Page\.(tsx|jsx)$", cleaned)
    if named:
        slug = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", named.group(1)).lower()
        return "/" + slug
    return None


def is_api_route_path(path: str) -> bool:
    cleaned = normalize_path(path)
    return bool(API_APP.search(cleaned) or API_PAGES.search(cleaned))


def is_handler_path(path: str) -> bool:
    cleaned = normalize_path(path)
    if HANDLER_FILE.search(cleaned):
        return True
    if WEBHOOK_DIR.search(cleaned) and re.search(r"\.(ts|js)$", cleaned):
        return True
    return bool(NAMED_HANDLER.search(cleaned))


def is_entry_path(path: str) -> bool:
    return is_page_path(path) or is_api_route_path(path) or is_handler_path(path)


def is_page_path(path: str) -> bool:
    cleaned = normalize_path(path)
    if PAGE_APP.search(cleaned) or PAGE_PAGES.search(cleaned) or PAGE_VITE.search(cleaned):
        return True
    if is_shared_path(cleaned):
        return False
    return bool(PAGE_NAMED.search(cleaned))


def classify_role(path: str) -> str | None:
    """Framework path rules from the Next/React indexer, mapped to graph roles."""
    cleaned = normalize_path(path)
    if is_page_path(cleaned):
        return "page"
    if is_api_route_path(cleaned) or is_handler_path(cleaned):
        return "api_route"
    if DB_FILE.search(cleaned):
        return "service"
    if SERVICE_DIR.search(cleaned) and re.search(r"\.(ts|js)$", cleaned) and not cleaned.endswith(".d.ts"):
        return "service"
    if COMPONENT_DIR.search(cleaned) and re.search(r"\.(tsx|jsx)$", cleaned):
        return "component"
    if re.search(r"\.(tsx|jsx)$", cleaned):
        return "component"
    if re.search(r"\.(ts|js)$", cleaned) and not cleaned.endswith(".d.ts"):
        return "service"
    return None


def nearest_package_root(path: str, path_set: set[str]) -> str | None:
    parts = path.replace("\\", "/").split("/")
    for i in range(len(parts) - 1, 0, -1):
        prefix = "/".join(parts[:i])
        if f"{prefix}/package.json" in path_set:
            return prefix
    if "package.json" in path_set:
        return ""
    return None


def match_file(base: str, path_set: set[str]) -> str | None:
    cleaned = base.replace("\\", "/").replace("/./", "/").lstrip("./")
    tries = [
        cleaned,
        f"{cleaned}.ts",
        f"{cleaned}.tsx",
        f"{cleaned}.js",
        f"{cleaned}.jsx",
        f"{cleaned}/index.ts",
        f"{cleaned}/index.tsx",
        f"{cleaned}/index.js",
        f"{cleaned}/index.jsx",
        f"{cleaned}/page.tsx",
        f"{cleaned}/route.ts",
    ]
    for candidate in tries:
        if candidate in path_set:
            return candidate
    lower = cleaned.lower()
    for existing in path_set:
        lowered = existing.lower()
        if lowered in {
            lower,
            f"{lower}.ts",
            f"{lower}.tsx",
            f"{lower}.js",
            f"{lower}.jsx",
            f"{lower}/index.ts",
            f"{lower}/index.tsx",
        }:
            return existing
    return None


def resolve_import_path(from_path: str, spec: str, path_set: set[str]) -> str | None:
    spec = spec.strip()
    if not spec:
        return None
    if not spec.startswith(".") and not spec.startswith("@/"):
        return None
    from_path = from_path.replace("\\", "/")
    if spec.startswith("@/"):
        rest = spec[2:]
        pkg_root = nearest_package_root(from_path, path_set)
        prefixes = []
        if pkg_root:
            prefixes.extend(
                [
                    f"{pkg_root}/src/{rest}",
                    f"{pkg_root}/{rest}",
                    f"{pkg_root}/app/{rest}",
                ]
            )
        prefixes.extend([f"src/{rest}", rest, f"app/{rest}"])
        for candidate in prefixes:
            hit = match_file(candidate, path_set)
            if hit:
                return hit
        return None

    directory = from_path.rsplit("/", 1)[0] if "/" in from_path else ""
    joined = f"{directory}/{spec}" if directory else spec
    parts: list[str] = []
    for part in joined.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return match_file("/".join(parts), path_set)


def _local_names(import_row: dict[str, Any]) -> list[str]:
    names: list[str] = []
    default = import_row.get("default")
    namespace = import_row.get("namespace")
    if isinstance(default, str) and default:
        names.append(default)
    if isinstance(namespace, str) and namespace:
        names.append(namespace)
    raw_names = import_row.get("names")
    if isinstance(raw_names, list):
        for name in raw_names:
            if isinstance(name, str) and name:
                names.append(name)
    return names


def build_file_graph(files: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Build {nodes, edges} from tree-sitter usage, not from imports alone.

    renders: imported binding appears as JSX
    calls: imported binding is invoked (or is the object of a member call)
    """
    path_set = {
        str(row.get("path") or "").replace("\\", "/").lstrip("./")
        for row in files
        if str(row.get("path") or "").strip()
    }
    roles: dict[str, str] = {}
    facts: dict[str, dict[str, Any]] = {}
    for row in files:
        path = str(row.get("path") or "").replace("\\", "/").lstrip("./")
        if not path:
            continue
        role = classify_role(path)
        if role:
            roles[path] = role
        facts[path] = row

    edges: list[dict[str, str]] = []
    seen = set()

    def add_edge(source: str, target: str, edge_type: str) -> None:
        if source == target:
            return
        if source not in roles or target not in roles:
            return
        key = (source, target, edge_type)
        if key in seen:
            return
        seen.add(key)
        edges.append({"source": source, "target": target, "type": edge_type})

    for path, row in facts.items():
        imports = row.get("imports")
        if not isinstance(imports, list):
            continue
        jsx = {name for name in (row.get("jsx") or []) if isinstance(name, str)}
        calls = {name for name in (row.get("calls") or []) if isinstance(name, str)}
        for item in imports:
            if not isinstance(item, dict):
                continue
            spec = str(item.get("spec") or "")
            target = resolve_import_path(path, spec, path_set)
            if not target:
                continue
            locals_ = _local_names(item)
            if jsx.intersection(locals_):
                add_edge(path, target, "renders")
            if calls.intersection(locals_):
                add_edge(path, target, "calls")

    used = {edge["source"] for edge in edges} | {edge["target"] for edge in edges}
    node_ids = {
        path
        for path, role in roles.items()
        if path in used or role in {"page", "api_route"}
    }
    if not node_ids:
        node_ids = set(roles)

    nodes = [
        {"id": path, "role": roles[path]}
        for path in sorted(node_ids, key=lambda p: (ROLE_ORDER.get(roles[p], 9), p))
    ]
    edges.sort(key=lambda e: (e["source"], e["type"], e["target"]))
    return {"nodes": nodes, "edges": edges}
