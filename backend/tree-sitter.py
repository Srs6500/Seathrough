#!/usr/bin/env python3
"""Parse source files with tree-sitter. JSON on stdin, JSON on stdout."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
from collections import Counter
from pathlib import PurePosixPath
from typing import Any

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from cluster_label import attach_cluster_labels  # noqa: E402
from feature_catalog import build_feature_catalog  # noqa: E402
from feature_discovery import discover_clusters  # noqa: E402
from feature_testing import verify_catalog  # noqa: E402
from file_graph import build_file_graph  # noqa: E402
from vibe_model import build_vibe_guide  # noqa: E402

INSTALL_HINT = (
    "tree-sitter is not installed. Run: "
    "python3 -m pip install -r backend/requirements-tree-sitter.txt"
)

MAX_SEXP_CHARS = 8_000
MAX_SEXP_DEPTH = 8
MAX_SEXP_NODES = 400
MAX_SYMBOLS = 80
MAX_ERRORS = 40
MAX_ERROR_TEXT = 120
MAX_NODES = 20_000
MAX_FILES = 400
MAX_WALK_NODES = 30_000
CHILD_TIMEOUT_SEC = 20

EXT_LANGUAGE = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".go": "go",
    ".java": "java",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".php": "php",
    ".rb": "ruby",
    ".rs": "rust",
}

SYMBOL_KINDS = {
    "function_declaration": "function",
    "function_definition": "function",
    "function_item": "function",
    "method_declaration": "function",
    "method_definition": "function",
    "arrow_function": "function",
    "class_declaration": "class",
    "class_definition": "class",
    "class_specifier": "class",
    "interface_declaration": "interface",
    "type_alias_declaration": "type",
    "enum_declaration": "enum",
    "struct_item": "struct",
    "impl_item": "impl",
}

# Keep Language objects alive for the process lifetime. Dropping them while a
# Parser still exists can SIGSEGV in tree-sitter's native layer.
_LANGUAGES: dict[str, Any] = {}
_LOAD_ERRORS: dict[str, str] = {}


def fail(message: str, code: int = 2) -> int:
    sys.stdout.write(json.dumps({"ok": False, "error": message}, ensure_ascii=True))
    sys.stdout.write("\n")
    return code


def skipped_file(path: str, language: str | None, reason: str) -> dict[str, Any]:
    return {
        "path": path,
        "language": language,
        "ok": False,
        "skipped": True,
        "reason": reason,
        "rootType": None,
        "nodeCount": 0,
        "errorCount": 0,
        "hasError": False,
        "sexp": "",
        "sexpTruncated": False,
        "symbols": [],
        "errors": [],
        "imports": [],
        "jsx": [],
        "calls": [],
    }


def failed_file(path: str, language: str | None, reason: str) -> dict[str, Any]:
    return {
        "path": path,
        "language": language,
        "ok": False,
        "skipped": False,
        "reason": reason,
        "rootType": None,
        "nodeCount": 0,
        "errorCount": 1,
        "hasError": True,
        "sexp": "",
        "sexpTruncated": False,
        "symbols": [],
        "errors": [
            {
                "type": "PARSE_FAILED",
                "line": 1,
                "column": 0,
                "text": reason[:MAX_ERROR_TEXT],
            }
        ],
        "imports": [],
        "jsx": [],
        "calls": [],
    }


def language_for_path(path: str) -> str | None:
    suffix = PurePosixPath(path).suffix.lower()
    return EXT_LANGUAGE.get(suffix)


def slice_text(source: bytes, node: Any, limit: int | None = None) -> str:
    start, end = node.byte_range
    start = max(0, int(start))
    end = max(start, int(end))
    text = source[start:end].decode("utf-8", errors="replace")
    if limit is not None:
        return text[:limit]
    return text


def make_parser(language: Any) -> Any:
    from tree_sitter import Parser

    try:
        return Parser(language)
    except TypeError:
        parser = Parser()
        if hasattr(parser, "language"):
            parser.language = language
        else:
            parser.set_language(language)
        return parser


def load_language(name: str) -> Any | None:
    if name in _LANGUAGES:
        return _LANGUAGES[name]
    if name in _LOAD_ERRORS:
        return None

    try:
        from tree_sitter import Language
    except ImportError:
        _LOAD_ERRORS[name] = INSTALL_HINT
        return None

    try:
        if name == "python":
            import tree_sitter_python as mod

            language = Language(mod.language())
        elif name == "javascript":
            import tree_sitter_javascript as mod

            language = Language(mod.language())
        elif name == "typescript":
            import tree_sitter_typescript as mod

            language = Language(mod.language_typescript())
        elif name == "tsx":
            import tree_sitter_typescript as mod

            language = Language(mod.language_tsx())
        elif name == "go":
            import tree_sitter_go as mod

            language = Language(mod.language())
        elif name == "java":
            import tree_sitter_java as mod

            language = Language(mod.language())
        elif name == "html":
            import tree_sitter_html as mod

            language = Language(mod.language())
        elif name == "css":
            import tree_sitter_css as mod

            language = Language(mod.language())
        elif name == "php":
            import tree_sitter_php as mod

            language = Language(mod.language_php())
        elif name == "ruby":
            import tree_sitter_ruby as mod

            language = Language(mod.language())
        elif name == "rust":
            import tree_sitter_rust as mod

            language = Language(mod.language())
        else:
            _LOAD_ERRORS[name] = f"No tree-sitter grammar for {name}."
            return None
        _LANGUAGES[name] = language
        return language
    except Exception as error:
        _LOAD_ERRORS[name] = f"Could not load the {name} grammar: {error}"
        return None


def iter_children(node: Any) -> list[Any]:
    count = int(getattr(node, "child_count", 0) or 0)
    children = []
    for index in range(min(count, 500)):
        child = node.child(index)
        if child is not None:
            children.append(child)
    return children


def node_name(source: bytes, node: Any) -> str | None:
    named = node.child_by_field_name("name") if hasattr(node, "child_by_field_name") else None
    if named is not None:
        text = slice_text(source, named, 120).strip()
        if text:
            return text
    for child in iter_children(node)[:6]:
        if child.type in {"identifier", "type_identifier", "property_identifier", "name"}:
            text = slice_text(source, child, 120).strip()
            if text:
                return text
    return None


def collect_symbols(source: bytes, root: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    stack = [root]
    seen = 0
    while stack and seen < MAX_WALK_NODES and len(out) < MAX_SYMBOLS:
        node = stack.pop()
        seen += 1
        kind = SYMBOL_KINDS.get(node.type)
        if kind:
            name = node_name(source, node)
            if name:
                out.append(
                    {
                        "kind": kind,
                        "name": name,
                        "type": node.type,
                        "line": int(node.start_point.row) + 1,
                        "column": int(node.start_point.column),
                    }
                )
        if node.type == "variable_declarator":
            value = node.child_by_field_name("value")
            if value is not None and value.type in {
                "arrow_function",
                "function",
                "function_expression",
            }:
                name = node_name(source, node)
                if name:
                    out.append(
                        {
                            "kind": "function",
                            "name": name,
                            "type": value.type,
                            "line": int(node.start_point.row) + 1,
                            "column": int(node.start_point.column),
                        }
                    )
        children = iter_children(node)
        for child in reversed(children):
            stack.append(child)
    return out


def collect_errors(source: bytes, root: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    stack = [root]
    seen = 0
    while stack and seen < MAX_WALK_NODES and len(out) < MAX_ERRORS:
        node = stack.pop()
        seen += 1
        if getattr(node, "is_error", False) or node.type == "ERROR" or getattr(
            node, "is_missing", False
        ):
            text = slice_text(source, node, MAX_ERROR_TEXT).replace("\n", " ").strip()
            out.append(
                {
                    "type": node.type,
                    "line": int(node.start_point.row) + 1,
                    "column": int(node.start_point.column),
                    "text": text,
                }
            )
        children = iter_children(node)
        for child in reversed(children):
            stack.append(child)
    return out


def count_nodes(root: Any) -> int:
    count = 0
    stack = [root]
    while stack and count < MAX_NODES:
        node = stack.pop()
        count += 1
        stack.extend(iter_children(node))
    return count


def sexp_for(root: Any) -> tuple[str, bool]:
    """Build a shallow S-expression without calling str(node) (that can SIGSEGV)."""
    parts: list[str] = []
    truncated = False
    stack: list[tuple[Any, int, str]] = [(root, 0, "open")]
    nodes = 0

    while stack:
        if len(parts) >= MAX_SEXP_CHARS or nodes >= MAX_SEXP_NODES:
            truncated = True
            break
        node, depth, phase = stack.pop()
        if phase == "close":
            parts.append(")")
            continue
        nodes += 1
        parts.append("(")
        parts.append(node.type)
        if depth >= MAX_SEXP_DEPTH:
            parts.append(")")
            truncated = True
            continue
        children = [child for child in iter_children(node) if getattr(child, "is_named", True)]
        if not children:
            parts.append(")")
            continue
        stack.append((node, depth, "close"))
        for child in reversed(children):
            stack.append((child, depth + 1, "open"))

    text = "".join(parts)
    if len(text) > MAX_SEXP_CHARS:
        return text[:MAX_SEXP_CHARS] + "…", True
    if truncated:
        return text + "…", True
    return text, False


def _strip_quotes(text: str) -> str:
    cleaned = text.strip()
    if len(cleaned) >= 2 and cleaned[0] in {"'", '"', "`"} and cleaned[-1] == cleaned[0]:
        return cleaned[1:-1]
    return cleaned


def _string_value(source: bytes, node: Any) -> str | None:
    if node.type == "string_fragment":
        return slice_text(source, node, 240)
    if node.type == "string":
        for child in iter_children(node):
            if child.type == "string_fragment":
                return slice_text(source, child, 240)
        return _strip_quotes(slice_text(source, node, 240))
    return None


def _first_identifier(source: bytes, node: Any) -> str | None:
    if node.type in {"identifier", "property_identifier", "type_identifier"}:
        text = slice_text(source, node, 80).strip()
        return text or None
    for child in iter_children(node):
        found = _first_identifier(source, child)
        if found:
            return found
    return None


def _import_local_name(source: bytes, specifier: Any) -> str | None:
    names = [
        slice_text(source, child, 80).strip()
        for child in iter_children(specifier)
        if child.type == "identifier"
    ]
    names = [name for name in names if name]
    return names[-1] if names else None


def _is_type_only_import(node: Any) -> bool:
    for child in iter_children(node):
        if child.type == "type":
            return True
    return False


def extract_usage(source: bytes, root: Any) -> dict[str, Any]:
    """Collect imports, JSX tags, and call roots from a JS/TS/TSX tree."""
    imports: list[dict[str, Any]] = []
    jsx: list[str] = []
    calls: list[str] = []
    seen_jsx: set[str] = set()
    seen_calls: set[str] = set()
    stack = [root]
    walked = 0

    while stack and walked < MAX_WALK_NODES:
        node = stack.pop()
        walked += 1
        kind = node.type

        if kind == "import_statement" and not _is_type_only_import(node):
            spec = None
            names: list[str] = []
            default = None
            namespace = None
            for child in iter_children(node):
                value = _string_value(source, child)
                if value:
                    spec = value
                if child.type != "import_clause":
                    continue
                for part in iter_children(child):
                    if part.type == "identifier":
                        default = slice_text(source, part, 80).strip() or default
                    elif part.type == "named_imports":
                        for spec_node in iter_children(part):
                            if spec_node.type != "import_specifier":
                                continue
                            local = _import_local_name(source, spec_node)
                            if local:
                                names.append(local)
                    elif part.type == "namespace_import":
                        namespace = _first_identifier(source, part)
            if spec:
                imports.append(
                    {
                        "spec": spec,
                        "names": names,
                        "default": default,
                        "namespace": namespace,
                    }
                )

        elif kind in {"jsx_self_closing_element", "jsx_opening_element"}:
            tag = None
            for child in iter_children(node):
                if child.type in {
                    "identifier",
                    "jsx_identifier",
                    "nested_identifier",
                    "member_expression",
                    "jsx_member_expression",
                }:
                    tag = _first_identifier(source, child)
                    break
            if tag and tag[0:1].isupper() and tag not in seen_jsx:
                seen_jsx.add(tag)
                jsx.append(tag)

        elif kind == "call_expression":
            callee = None
            for child in iter_children(node):
                if child.type in {"identifier", "member_expression"}:
                    callee = child
                    break
            if callee is not None:
                name = _first_identifier(source, callee)
                if name and name not in {"require", "import"} and name not in seen_calls:
                    seen_calls.add(name)
                    calls.append(name)
                if callee.type == "identifier" and name == "require":
                    spec = None
                    for child in iter_children(node):
                        if child.type != "arguments":
                            continue
                        for arg in iter_children(child):
                            spec = _string_value(source, arg) or spec
                    parent = getattr(node, "parent", None)
                    local = None
                    if parent is not None and parent.type == "variable_declarator":
                        local = _first_identifier(source, parent)
                    if spec:
                        imports.append(
                            {
                                "spec": spec,
                                "names": [local] if local else [],
                                "default": local,
                                "namespace": None,
                            }
                        )

        children = iter_children(node)
        for child in reversed(children):
            stack.append(child)

    return {"imports": imports, "jsx": jsx, "calls": calls}


def parse_file(path: str, content: str) -> dict[str, Any]:
    language = language_for_path(path)
    if not language:
        return skipped_file(path, None, "No tree-sitter grammar for this file type.")

    language_obj = load_language(language)
    if language_obj is None:
        return skipped_file(path, language, _LOAD_ERRORS.get(language) or INSTALL_HINT)

    source = content.encode("utf-8")
    parser = None
    tree = None
    try:
        parser = make_parser(language_obj)
        tree = parser.parse(source)
        if tree is None:
            return failed_file(path, language, "Parser returned no tree.")
        root = tree.root_node
        errors = collect_errors(source, root)
        sexp, truncated = sexp_for(root)
        symbols = collect_symbols(source, root)
        try:
            usage = extract_usage(source, root)
        except Exception:
            usage = {"imports": [], "jsx": [], "calls": []}
        return {
            "path": path,
            "language": language,
            "ok": not bool(root.has_error),
            "skipped": False,
            "reason": None,
            "rootType": root.type,
            "nodeCount": count_nodes(root),
            "errorCount": len(errors),
            "hasError": bool(root.has_error),
            "sexp": sexp,
            "sexpTruncated": truncated,
            "symbols": symbols,
            "errors": errors,
            "imports": usage["imports"],
            "jsx": usage["jsx"],
            "calls": usage["calls"],
        }
    except Exception as error:
        return failed_file(path, language, f"Parse failed: {error}")
    finally:
        # Drop native handles in a safe order before the next file.
        tree = None
        parser = None


def parse_file_in_subprocess(path: str, content: str) -> dict[str, Any]:
    """Fresh interpreter — slower, but safe after a native crash."""
    try:
        proc = subprocess.run(
            [sys.executable, "-u", os.path.abspath(__file__), "--one-file"],
            input=json.dumps({"path": path, "content": content}, ensure_ascii=True),
            capture_output=True,
            text=True,
            timeout=CHILD_TIMEOUT_SEC,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
    except subprocess.TimeoutExpired:
        return failed_file(path, language_for_path(path), "Tree-sitter timed out on this file.")
    except OSError as error:
        return failed_file(path, language_for_path(path), f"Could not start parser: {error}")
    if proc.returncode != 0 or not proc.stdout.strip():
        return failed_file(path, language_for_path(path), "Tree-sitter crashed on this file.")
    try:
        parsed = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return failed_file(
            path,
            language_for_path(path),
            "Tree-sitter returned unreadable output for this file.",
        )
    if not isinstance(parsed, dict):
        return failed_file(
            path,
            language_for_path(path),
            "Tree-sitter returned unreadable output for this file.",
        )
    return parsed


def parse_file_in_child(path: str, content: str) -> dict[str, Any]:
    """Parse one file in a forked process so a native crash cannot kill the scan."""
    if os.name != "posix" or not hasattr(os, "fork"):
        return parse_file(path, content)

    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        try:
            signal.alarm(CHILD_TIMEOUT_SEC)
            result = parse_file(path, content)
            payload = json.dumps(result, ensure_ascii=True).encode("utf-8")
            written = 0
            while written < len(payload):
                written += os.write(write_fd, payload[written:])
        except Exception as error:
            fallback = failed_file(
                path,
                language_for_path(path),
                f"Parse failed: {error}",
            )
            try:
                os.write(write_fd, json.dumps(fallback, ensure_ascii=True).encode("utf-8"))
            except OSError:
                pass
        finally:
            try:
                os.close(write_fd)
            except OSError:
                pass
            os._exit(0)

    os.close(write_fd)
    chunks: list[bytes] = []
    while True:
        try:
            data = os.read(read_fd, 65_536)
        except OSError:
            break
        if not data:
            break
        chunks.append(data)
    os.close(read_fd)
    _pid, status = os.waitpid(pid, 0)
    crashed = os.WIFSIGNALED(status) or (
        os.WIFEXITED(status) and os.WEXITSTATUS(status) != 0
    )
    raw = b"".join(chunks)
    if crashed or not raw.strip():
        return parse_file_in_subprocess(path, content)
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return parse_file_in_subprocess(path, content)
    if not isinstance(parsed, dict):
        return parse_file_in_subprocess(path, content)
    return parsed


def apply_sandbox(payload: dict[str, Any]) -> None:
    sandbox = payload.get("sandbox")
    if not isinstance(sandbox, dict):
        return
    mapping = {
        "baseUrl": "REPO_SCAN_TEST_BASE_URL",
        "apiUrl": "REPO_SCAN_TEST_API_URL",
        "user": "REPO_SCAN_TEST_USER",
        "password": "REPO_SCAN_TEST_PASSWORD",
    }
    for key, env_name in mapping.items():
        value = sandbox.get(key)
        if isinstance(value, str) and value.strip():
            os.environ[env_name] = value.strip()
    if (os.environ.get("REPO_SCAN_TEST_BASE_URL") or "").strip():
        os.environ["REPO_SCAN_SANDBOX"] = "1"


def parse_payload(payload: dict[str, Any]) -> dict[str, Any]:
    apply_sandbox(payload)
    raw_files = payload.get("files")
    if not isinstance(raw_files, list):
        return {"ok": False, "error": "Send JSON with a files array."}

    files_out: list[dict[str, Any]] = []
    sources: dict[str, str] = {}
    for item in raw_files[:MAX_FILES]:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip()
        if not path:
            continue
        content = item.get("content")
        if content is None:
            content = ""
        if not isinstance(content, str):
            content = str(content)
        sources[path] = content
        files_out.append(parse_file_in_child(path, content))

    parsed = [row for row in files_out if not row["skipped"]]
    skipped = [row for row in files_out if row["skipped"]]
    languages = Counter(
        row["language"] for row in parsed if isinstance(row.get("language"), str)
    )
    graph = build_file_graph(files_out)
    labeling: dict[str, Any] = {}
    clusters = attach_cluster_labels(
        discover_clusters(graph),
        graph,
        files_out,
        label_with_llm=bool(payload.get("labelClusters")),
        repo_key=str(payload.get("fullName") or "").strip(),
        stats=labeling,
    )
    catalog = verify_catalog(build_feature_catalog(clusters, graph), files_out, sources)
    guide = build_vibe_guide(
        full_name=str(payload.get("fullName") or "").strip() or None,
        catalog=catalog,
        sources=sources,
        languages=dict(languages),
    )
    parse_issues: list[dict[str, Any]] = []
    for row in parsed:
        if not row.get("hasError") and int(row.get("errorCount") or 0) <= 0:
            continue
        first = (row.get("errors") or [None])[0] or {}
        parse_issues.append(
            {
                "path": row.get("path"),
                "errorCount": int(row.get("errorCount") or 0),
                "line": first.get("line"),
                "text": first.get("text") or row.get("reason"),
            }
        )
    return {
        "ok": True,
        "fullName": str(payload.get("fullName") or "").strip() or None,
        "ref": str(payload.get("ref") or "").strip() or None,
        "truncated": bool(payload.get("truncated")),
        "fileCount": len(files_out),
        "parsedCount": len(parsed),
        "skippedCount": len(skipped),
        "errorCount": sum(int(row.get("errorCount") or 0) for row in parsed),
        "errorFileCount": len(parse_issues),
        "parseIssues": parse_issues,
        "languages": dict(sorted(languages.items())),
        "graph": graph,
        "clusters": clusters,
        "catalog": catalog,
        "guide": guide,
        "labeling": labeling,
        "files": files_out,
    }


def self_test() -> int:
    try:
        from tree_sitter import Language, Parser  # noqa: F401
    except ImportError:
        return fail(INSTALL_HINT)

    empty = parse_payload({"files": []})
    if empty.get("fileCount") != 0 or empty.get("ok") is not True:
        return fail("Empty files should parse as an empty result.")
    if empty.get("clusters") != []:
        return fail("Empty files should have no clusters.")
    if (empty.get("catalog") or {}).get("features") != []:
        return fail("Empty files should have an empty feature catalog.")
    if (empty.get("guide") or {}).get("features") != []:
        return fail("Empty files should have an empty vibe guide.")

    invalid = parse_payload({})
    if invalid.get("ok") is not False:
        return fail("Missing files array should fail.")

    python = parse_file(
        "app.py",
        "def greet(name):\n    return name\n\nclass Box:\n    pass\n",
    )
    if python.get("language") != "python" or python.get("hasError"):
        return fail("Python fixture should parse cleanly.")
    names = {item["name"] for item in python.get("symbols") or []}
    if "greet" not in names or "Box" not in names:
        return fail("Python fixture should list greet and Box.")
    if "function_definition" not in python.get("sexp", ""):
        return fail("Python sexp should include function_definition.")

    tsx = parse_file("src/pages/Home.tsx", "export function Home() {\n  return <h1>Home</h1>;\n}\n")
    if tsx.get("language") != "tsx" or tsx.get("hasError"):
        return fail("TSX fixture should parse cleanly.")
    tsx_names = {item["name"] for item in tsx.get("symbols") or []}
    if "Home" not in tsx_names:
        return fail("TSX fixture should list Home.")

    broken = parse_file("broken.py", "def (\n")
    if not broken.get("hasError") or broken.get("errorCount", 0) < 1:
        return fail("Broken Python should report a parse error.")

    skipped = parse_file("README.md", "# hi\n")
    if not skipped.get("skipped"):
        return fail("Markdown should be skipped.")

    blank = parse_file("empty.py", "")
    if blank.get("skipped") or blank.get("language") != "python":
        return fail("Empty Python should still parse.")

    graph_payload = parse_payload(
        {
            "files": [
                {
                    "path": "app/login/page.tsx",
                    "content": (
                        'import { LoginForm } from "@/components/LoginForm";\n'
                        'import { Stats } from "@/components/Stats";\n'
                        "export default function LoginPage() {\n"
                        "  return <LoginForm />;\n"
                        "}\n"
                    ),
                },
                {
                    "path": "components/LoginForm.tsx",
                    "content": (
                        'import { signIn } from "@/lib/auth";\n'
                        "export function LoginForm() {\n"
                        "  return <button onClick={() => signIn()}>Go</button>;\n"
                        "}\n"
                    ),
                },
                {
                    "path": "lib/auth.ts",
                    "content": "export function signIn() { return true; }\n",
                },
                {
                    "path": "app/dashboard/page.tsx",
                    "content": (
                        'import { Stats } from "@/components/Stats";\n'
                        "export default function DashboardPage() {\n"
                        "  return <Stats />;\n"
                        "}\n"
                    ),
                },
                {
                    "path": "components/Stats.tsx",
                    "content": (
                        'import { query } from "@/lib/db";\n'
                        "export function Stats() {\n"
                        "  const rows = query();\n"
                        "  return <div>{rows.length}</div>;\n"
                        "}\n"
                    ),
                },
                {
                    "path": "lib/db.ts",
                    "content": "export function query() { return []; }\n",
                },
            ]
        }
    )
    graph = graph_payload.get("graph") or {}
    nodes = {(n.get("id"), n.get("role")) for n in graph.get("nodes") or []}
    edges = {(e.get("source"), e.get("target"), e.get("type")) for e in graph.get("edges") or []}
    expected_nodes = {
        ("app/login/page.tsx", "page"),
        ("components/LoginForm.tsx", "component"),
        ("lib/auth.ts", "service"),
        ("app/dashboard/page.tsx", "page"),
        ("components/Stats.tsx", "component"),
        ("lib/db.ts", "service"),
    }
    if not expected_nodes.issubset(nodes):
        return fail(f"Graph nodes missing {expected_nodes - nodes}.")
    expected_edges = {
        ("app/login/page.tsx", "components/LoginForm.tsx", "renders"),
        ("components/LoginForm.tsx", "lib/auth.ts", "calls"),
        ("app/dashboard/page.tsx", "components/Stats.tsx", "renders"),
        ("components/Stats.tsx", "lib/db.ts", "calls"),
    }
    if not expected_edges.issubset(edges):
        return fail(f"Graph edges missing {expected_edges - edges}.")
    if ("app/login/page.tsx", "components/Stats.tsx", "renders") in edges:
        return fail("Unused import should not create a renders edge.")
    if graph_payload.get("errorFileCount"):
        return fail("Graph fixture should not report tree-sitter recoveries.")
    cluster_groups = {
        frozenset(item.get("files") or [])
        for item in graph_payload.get("clusters") or []
    }
    expected_clusters = {
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
    if cluster_groups != expected_clusters:
        return fail(f"Feature clusters were {cluster_groups}.")
    login_cluster = next(
        (
            item
            for item in graph_payload.get("clusters") or []
            if "app/login/page.tsx" in (item.get("files") or [])
        ),
        None,
    )
    if not login_cluster or not login_cluster.get("name"):
        return fail("Login cluster should have a user-facing name.")
    if login_cluster.get("summary", {}).get("files") and any(
        "content" in file_row
        for file_row in login_cluster["summary"]["files"]
    ):
        return fail("Cluster summary must not include file contents.")
    catalog = graph_payload.get("catalog") or {}
    auth = next(
        (
            item
            for item in catalog.get("features") or []
            if item.get("feature_id") == "authentication"
        ),
        None,
    )
    if not auth or "lib/auth.ts" not in (auth.get("primary_files") or []):
        return fail("Catalog should store authentication with lib/auth.ts as evidence.")
    if auth.get("verification_status") != "inconclusive":
        return fail(
            "Authentication should be inconclusive until browser tests can run."
        )
    auth_tests = {
        item.get("name"): item
        for item in (auth.get("verification") or {}).get("tests") or []
        if isinstance(item, dict)
    }
    if (auth_tests.get("Login entry exists") or {}).get("status") != "pass":
        return fail("Login entry static check should pass on the graph fixture.")
    if (auth_tests.get("Auth service exists") or {}).get("status") != "pass":
        return fail("signIn should satisfy the auth service static check.")
    if (auth_tests.get("Login page renders") or {}).get("status") != "blocked":
        return fail("Generated Playwright tests should stay blocked without a sandbox.")
    generated = (auth.get("verification") or {}).get("generated_test") or {}
    if "seethrough-auth.spec.ts" not in str(generated.get("path") or ""):
        return fail("Authentication should generate tests/seethrough-auth.spec.ts.")
    if (auth_tests.get("Private route access protected") or {}).get("status") != "inconclusive":
        return fail("Auth without a guard should not claim every route is protected.")
    auth_index = (catalog.get("file_index") or {}).get("lib/auth.ts") or {}
    if "authentication" not in (auth_index.get("primary") or []):
        return fail("file_index must map lib/auth.ts back to authentication.")

    issues = parse_payload({"files": [{"path": "broken.py", "content": "def (\n"}]})
    if not issues.get("errorFileCount"):
        return fail("Broken Python should appear as a parse issue.")
    if not any(item.get("path") == "broken.py" for item in issues.get("parseIssues") or []):
        return fail("Broken Python should be listed in parseIssues.")

    sys.stdout.write(json.dumps({"ok": True, "selfTest": True}, ensure_ascii=True))
    sys.stdout.write("\n")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    if "--one-file" in argv:
        raw = sys.stdin.read()
        if not raw.strip():
            return fail("Send JSON with path and content.")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return fail("Send valid JSON.")
        if not isinstance(payload, dict):
            return fail("Send a JSON object with path and content.")
        path = str(payload.get("path") or "").strip()
        content = payload.get("content")
        if not path:
            return fail("Missing path.")
        if content is None:
            content = ""
        if not isinstance(content, str):
            content = str(content)
        result = parse_file(path, content)
        sys.stdout.write(json.dumps(result, ensure_ascii=True))
        sys.stdout.write("\n")
        return 0

    raw = sys.stdin.read()
    if not raw.strip():
        return fail("Send JSON with a files array.")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return fail("Send valid JSON.")
    if not isinstance(payload, dict):
        return fail("Send a JSON object with a files array.")

    try:
        result = parse_payload(payload)
    except Exception as error:
        message = str(error)
        if "tree_sitter" in message or "No module named" in message:
            return fail(INSTALL_HINT)
        return fail(f"Parse failed: {error}")

    sys.stdout.write(json.dumps(result, ensure_ascii=True))
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
