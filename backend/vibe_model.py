"""Structured guide to an app: overview, feature walks, issues, tests.

Steps come from files and calls we actually find. A login feature without
a credential check does not get a 'server verifies the password' step.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any

from file_graph import classify_role, route_for_path

MAX_STEPS = 6
MAX_SNIPPET = 420

PASSWORD_CHECK = re.compile(
    r"bcrypt|argon2|scrypt|compare(Hash|Password)|verify(Password|Credentials)|"
    r"checkPassword|password_verify|timingSafeEqual",
    re.I,
)
SESSION_CHECK = re.compile(
    r"getServerSession|getSession|requireAuth|requireUser|protectedRoute|"
    r"unauthenticated|middleware|verifyToken|jwt\.verify",
    re.I,
)
HARDCODED_USERS = re.compile(
    r"(demo@|test@example|fakeUsers|SAMPLE_USERS|mockUsers)\b|"
    r"password:\s*[\"'](password|123456|admin)[\"']",
    re.I,
)
CLIENT_SECRET = re.compile(
    r"(sk_live_|sk_test_|supabaseServiceRole|BEGIN PRIVATE KEY|"
    r"AWS_SECRET|password\s*[:=]\s*[\"'][^\"']{8,})",
    re.I,
)
LOCAL_ONLY_SAVE = re.compile(
    r"onSubmit|handleSubmit|handleSave",
    re.I,
)
NETWORK_SAVE = re.compile(
    r"fetch\(|axios\.|prisma\.|\.insert\(|\.update\(|\.create\(",
    re.I,
)
STRIPE_SUCCESS = re.compile(r"payment.?success|checkout\.session|confirmPayment", re.I)
STRIPE_UI_ONLY = re.compile(r"setSuccess\(true\)|Payment successful", re.I)
DB_HINTS = (
    ("Prisma", re.compile(r"prisma|@prisma/client", re.I)),
    ("Supabase", re.compile(r"supabase", re.I)),
    ("Postgres", re.compile(r"postgres|postgresql|DATABASE_URL", re.I)),
    ("MongoDB", re.compile(r"mongoose|mongodb", re.I)),
    ("SQLite", re.compile(r"sqlite", re.I)),
    ("Firebase", re.compile(r"firebase|firestore", re.I)),
)
INTEGRATION_HINTS = (
    ("Stripe", re.compile(r"stripe", re.I)),
    ("Clerk", re.compile(r"@clerk|clerk", re.I)),
    ("NextAuth", re.compile(r"next-auth", re.I)),
    ("Auth.js", re.compile(r"@auth/core", re.I)),
    ("OpenAI", re.compile(r"openai", re.I)),
    ("Resend", re.compile(r"resend", re.I)),
)
TECH_HINTS = (
    ("Next.js", re.compile(r"next/|\"next\"", re.I)),
    ("React", re.compile(r"from [\"']react[\"']", re.I)),
    ("Vite", re.compile(r"vite", re.I)),
    ("FastAPI", re.compile(r"fastapi", re.I)),
    ("Express", re.compile(r"express", re.I)),
    ("Tailwind", re.compile(r"tailwind", re.I)),
    ("TypeScript", re.compile(r"\.(tsx|ts)$")),
)


def _clean(path: Any) -> str:
    return str(path or "").replace("\\", "/").lstrip("./").strip()


def _stem(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    return name.rsplit(".", 1)[0]


def _blob(paths: list[str], sources: dict[str, str]) -> str:
    return "\n".join(sources.get(path) or "" for path in paths)


def _neighbors(graph: dict[str, Any], start: str, edge_type: str | None = None) -> list[str]:
    found: list[str] = []
    for edge in graph.get("edges") or []:
        if edge.get("source") != start:
            continue
        if edge_type and edge.get("type") != edge_type:
            continue
        target = str(edge.get("target") or "")
        if target and target not in found:
            found.append(target)
    return found


def _walk(graph: dict[str, Any], starts: list[str]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    queue = [path for path in starts if path]
    while queue and len(ordered) < MAX_STEPS:
        path = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        ordered.append(path)
        for nxt in _neighbors(graph, path):
            if nxt not in seen:
                queue.append(nxt)
    return ordered


def _pages(catalog: dict[str, Any], graph: dict[str, Any]) -> list[dict[str, str]]:
    pages: list[dict[str, str]] = []
    seen: set[str] = set()
    for node in graph.get("nodes") or []:
        path = str(node.get("id") or "")
        if node.get("role") != "page" or not path:
            continue
        route = route_for_path(path) or ("/" + _stem(path).replace("Page", "").lower())
        if route in seen:
            continue
        seen.add(route)
        pages.append({"route": route, "file": path, "name": _page_name(route, path)})
    for feature in catalog.get("features") or []:
        for route in feature.get("entry_points") or []:
            text = str(route).strip()
            if text.startswith("/") and text not in seen:
                seen.add(text)
                pages.append({"route": text, "file": "", "name": _page_name(text, "")})
    return pages


def _page_name(route: str, path: str) -> str:
    if route in {"/", ""}:
        return "Home"
    slug = route.strip("/").split("/")[-1].replace("-", " ").replace("_", " ")
    return slug[:1].upper() + slug[1:] if slug else (_stem(path) or "Page")


def _detect_named(blob: str, hints: tuple[tuple[str, re.Pattern[str]], ...]) -> list[str]:
    found: list[str] = []
    for name, pattern in hints:
        if pattern.search(blob) and name not in found:
            found.append(name)
    return found


def _purpose(name: str, features: list[dict[str, Any]], pages: list[dict[str, str]]) -> str:
    feature_names = [str(item.get("name") or "").strip() for item in features if item.get("name")]
    page_names = [str(item.get("name") or "") for item in pages]
    joined = " ".join(feature_names + page_names).lower()
    bits: list[str] = []
    if any(word in joined for word in ("login", "auth", "account", "signup")):
        bits.append("accounts")
    if any(word in joined for word in ("pay", "checkout", "stripe", "subscri")):
        bits.append("payments")
    if any(word in joined for word in ("task", "todo", "order", "trade")):
        bits.append("day-to-day work")
    if any(word in joined for word in ("chat", "message")):
        bits.append("messaging")
    if not bits:
        if feature_names:
            return f"{name} includes {', '.join(feature_names[:3])}."
        return f"{name} is a web app."
    if len(bits) == 1:
        return f"{name} is an app with {bits[0]}."
    return f"{name} is an app with {bits[0]} and {bits[1]}."


def _project_name(full_name: str | None) -> str:
    if not full_name or "/" not in full_name:
        return full_name or "Your project"
    return full_name.split("/", 1)[1]


def _step_from_file(
    path: str,
    sources: dict[str, str],
    tested_files: set[str],
) -> dict[str, Any] | None:
    source = sources.get(path) or ""
    role = classify_role(path) or "service"
    route = route_for_path(path)
    symbols = re.findall(
        r"(?:export (?:async )?function|export const|def )\s*([A-Za-z_][A-Za-z0-9_]*)",
        source,
    )
    title = ""
    detail = ""
    if role == "page":
        title = f"Opens {route}" if route else f"Opens {_stem(path)}"
        detail = "This is a screen someone can visit."
    elif role == "component":
        if re.search(r'type\s*=\s*[\"\']password[\"\']', source):
            title = "Collects email and password"
            detail = "The screen includes a password field."
        elif re.search(r"<form\b", source, re.I):
            title = "Shows a form"
            detail = "Someone can type into a form on this screen."
        else:
            title = f"Shows {_stem(path)}"
            detail = "This piece of the screen is rendered from this file."
    elif role == "api_route":
        title = f"Handles {route}" if route else f"Handles {_stem(path)}"
        detail = "The browser talks to this server route."
    else:
        if PASSWORD_CHECK.search(source):
            title = "Checks the password"
            detail = "This file compares a password or verifies credentials."
        elif SESSION_CHECK.search(source):
            title = "Checks who is signed in"
            detail = "This file looks for a session or token."
        elif re.search(r"stripe|checkout", source, re.I):
            title = "Talks to payments"
            detail = "This file calls a payments library."
        elif symbols:
            title = f"Runs {symbols[0]}"
            detail = "This helper is called from the feature."
        else:
            title = f"Uses {_stem(path)}"
            detail = "Related logic lives in this file."
    snippet = source.strip()
    if len(snippet) > MAX_SNIPPET:
        snippet = snippet[: MAX_SNIPPET - 1] + "…"
    confirmed = path in tested_files
    return {
        "id": path,
        "title": title,
        "detail": detail,
        "file": path,
        "functions": symbols[:4],
        "route": route,
        "role": role,
        "origin": "confirmed_by_test" if confirmed else "from_code",
        "snippet": snippet,
    }


def _tested_files(feature: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    verification = feature.get("verification") or {}
    for test in verification.get("tests") or []:
        if test.get("status") != "pass":
            continue
        for path in test.get("source_candidates") or []:
            found.add(_clean(path))
        evidence = test.get("evidence") if isinstance(test.get("evidence"), dict) else {}
        for path in evidence.get("source_files") or []:
            found.add(_clean(path))
    return found


def _feature_guide(
    feature: dict[str, Any],
    graph: dict[str, Any],
    sources: dict[str, str],
) -> dict[str, Any]:
    starts = [_clean(path) for path in feature.get("primary_files") or []]
    walked = _walk(graph, starts)
    tested = _tested_files(feature)
    steps = []
    for path in walked:
        step = _step_from_file(path, sources, tested)
        if step:
            steps.append(step)
    verification = feature.get("verification") or {}
    tests = []
    for item in verification.get("tests") or []:
        status = str(item.get("status") or "inconclusive")
        mapped = {
            "pass": "pass",
            "fail": "fail",
            "blocked": "needs_setup",
            "inconclusive": "not_sure",
        }.get(status, "not_sure")
        tests.append(
            {
                "id": str(item.get("id") or item.get("name")),
                "name": str(item.get("name") or "Check"),
                "status": mapped,
                "detail": str(item.get("explanation") or ""),
            }
        )
    simple = _simple_explanation(feature, steps)
    return {
        "id": str(feature.get("feature_id") or ""),
        "name": str(feature.get("name") or "Feature"),
        "description": str(feature.get("description") or ""),
        "entry_points": [str(item) for item in feature.get("entry_points") or []],
        "status": str(feature.get("verification_status") or "not_tested"),
        "steps": steps,
        "tests": tests,
        "simple": simple,
    }


def _simple_explanation(feature: dict[str, Any], steps: list[dict[str, Any]]) -> str:
    name = str(feature.get("name") or "This feature")
    if not steps:
        return f"{name} is in the repo, but SeeThrough could not follow a code path for it yet."
    parts = [str(step.get("title") or "").rstrip(".") for step in steps[:4] if step.get("title")]
    if not parts:
        return f"{name} is implemented in the files we found."
    if len(parts) == 1:
        return f"{name} {parts[0][0].lower() + parts[0][1:]}."
    lead = parts[0][0].lower() + parts[0][1:]
    rest = ", then ".join(item[0].lower() + item[1:] for item in parts[1:])
    return f"{name} {lead}, then {rest}."


def _issues(
    features: list[dict[str, Any]],
    sources: dict[str, str],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for feature in features:
        fid = str(feature.get("feature_id") or "")
        name = str(feature.get("name") or "This feature")
        paths = [_clean(path) for path in feature.get("primary_files") or []]
        blob = _blob(paths, sources)
        verification = feature.get("verification") or {}
        failed = [
            item
            for item in verification.get("tests") or []
            if item.get("status") == "fail"
        ]
        if failed:
            first = failed[0]
            issues.append(
                {
                    "id": f"{fid}-failed-test",
                    "feature_id": fid,
                    "title": f"{name} did not behave as intended",
                    "confidence": "confirmed",
                    "what": str(first.get("explanation") or first.get("name")),
                    "why": "A check against the running app failed.",
                    "next": str(first.get("suggested_fix") or "Open the feature and fix the failing check."),
                    "evidence": paths[:4],
                }
            )
        loginish = re.search(r"login|auth|sign.?in", name, re.I)
        if loginish and re.search(r'type\s*=\s*[\"\']password[\"\']', blob):
            if not PASSWORD_CHECK.search(blob):
                issues.append(
                    {
                        "id": f"{fid}-login-no-verify",
                        "feature_id": fid,
                        "title": f"{name} may not check the password",
                        "confidence": "needs_testing",
                        "what": "The screen collects a password, but no password check showed up in these files.",
                        "why": "Someone might get in without a real credential check.",
                        "next": "Sign in with a wrong password. If the app still lets you through, add a server-side check.",
                        "evidence": paths[:4],
                    }
                )
        private = any(
            "/dashboard" in str(route) or "/settings" in str(route) or "/account" in str(route)
            for route in feature.get("entry_points") or []
        )
        if private and not SESSION_CHECK.search(blob):
            issues.append(
                {
                    "id": f"{fid}-private-open",
                    "feature_id": fid,
                    "title": f"{name} may be open without a sign-in check",
                    "confidence": "needs_testing",
                    "what": "This looks like a private screen, and no session check showed up in these files.",
                    "why": "Someone might open it without signing in.",
                    "next": "Open the page in a private window. If it loads, add a server-side session check.",
                    "evidence": paths[:4],
                }
            )
        if HARDCODED_USERS.search(blob):
            issues.append(
                {
                    "id": f"{fid}-hardcoded",
                    "feature_id": fid,
                    "title": f"{name} may be using sample data",
                    "confidence": "needs_testing",
                    "what": "These files include demo users or hardcoded sample values.",
                    "why": "The screen might look finished while showing fake data.",
                    "next": "Confirm the live data source. Replace sample lists with a real query if needed.",
                    "evidence": paths[:4],
                }
            )
        if CLIENT_SECRET.search(blob) and re.search(r"\.(tsx|jsx|ts)$", " ".join(paths)):
            if not re.search(r"(^|/)(app/api|pages/api|server)/", " ".join(paths)):
                issues.append(
                    {
                        "id": f"{fid}-secret",
                        "feature_id": fid,
                        "title": "A secret may be sitting in the browser code",
                        "confidence": "confirmed",
                        "what": "A private key or live secret appears in a client file.",
                        "why": "Anyone can read client code and reuse that secret.",
                        "next": "Move the secret to the server and rotate it.",
                        "evidence": paths[:4],
                    }
                )
        if LOCAL_ONLY_SAVE.search(blob) and not NETWORK_SAVE.search(blob):
            issues.append(
                {
                    "id": f"{fid}-local-save",
                    "feature_id": fid,
                    "title": f"{name} may not actually save",
                    "confidence": "needs_testing",
                    "what": "A save handler updates the screen but no request or database write showed up.",
                    "why": "A refresh could wipe what someone just entered.",
                    "next": "Submit the form, refresh, and see if the value is still there.",
                    "evidence": paths[:4],
                }
            )
        if STRIPE_UI_ONLY.search(blob) and not STRIPE_SUCCESS.search(blob):
            issues.append(
                {
                    "id": f"{fid}-pay-ui",
                    "feature_id": fid,
                    "title": "Payments may show success too early",
                    "confidence": "needs_testing",
                    "what": "The UI talks about a successful payment without a confirmed checkout session in these files.",
                    "why": "Someone could see a success state without being charged.",
                    "next": "Complete a test payment and confirm the server received a checkout session.",
                    "evidence": paths[:4],
                }
            )
    return issues[:12]


def build_vibe_guide(
    *,
    full_name: str | None,
    catalog: dict[str, Any] | None,
    sources: dict[str, str] | None,
    languages: dict[str, int] | None = None,
) -> dict[str, Any]:
    catalog = catalog if isinstance(catalog, dict) else {}
    sources = {_clean(key): value for key, value in (sources or {}).items() if value}
    graph = catalog.get("graph") if isinstance(catalog.get("graph"), dict) else {"nodes": [], "edges": []}
    raw_features = [item for item in catalog.get("features") or [] if isinstance(item, dict)]
    pages = _pages(catalog, graph)
    features = [_feature_guide(item, graph, sources) for item in raw_features]
    issues = _issues(raw_features, sources)
    blob = "\n".join(sources.values())
    tech = _detect_named(blob, TECH_HINTS)
    if languages:
        if languages.get("tsx") or languages.get("ts"):
            if "TypeScript" not in tech:
                tech.append("TypeScript")
    database = _detect_named(blob, DB_HINTS)
    integrations = _detect_named(blob, INTEGRATION_HINTS)
    name = _project_name(full_name)
    return {
        "name": name,
        "fullName": full_name,
        "purpose": _purpose(name, features, pages),
        "counts": {
            "pages": len(pages),
            "features": len(features),
            "issues": len(issues),
            "database": 1 if database else 0,
        },
        "pages": pages,
        "features": features,
        "issues": issues,
        "tech": tech,
        "database": database,
        "integrations": integrations,
    }


def answer_question(question: str, guide: dict[str, Any]) -> dict[str, Any]:
    text = (question or "").strip()
    if not text:
        return {"answer": "Ask about a page, a feature, or a file.", "feature_id": None, "files": []}
    lowered = text.lower()
    features = guide.get("features") or []
    issues = guide.get("issues") or []
    hit = None
    for feature in features:
        name = str(feature.get("name") or "").lower()
        if name and name in lowered:
            hit = feature
            break
    if not hit:
        for word, needles in (
            ("login", ("login", "sign in", "auth", "password")),
            ("pay", ("pay", "stripe", "subscribe", "checkout")),
            ("dashboard", ("dashboard", "home")),
        ):
            if any(item in lowered for item in needles):
                hit = next(
                    (
                        feature
                        for feature in features
                        if word in str(feature.get("name") or "").lower()
                        or word in str(feature.get("id") or "")
                    ),
                    None,
                )
                if hit:
                    break
    if "where" in lowered and ("user" in lowered or "stored" in lowered):
        stores = guide.get("database") or []
        if stores:
            return {
                "answer": f"User records look like they live in {stores[0]}.",
                "feature_id": (hit or {}).get("id"),
                "files": [],
            }
        return {
            "answer": "SeeThrough did not find a database library in this scan.",
            "feature_id": None,
            "files": [],
        }
    if "supabase" in lowered:
        uses = "Supabase" in (guide.get("database") or []) or "Supabase" in (
            guide.get("integrations") or []
        )
        return {
            "answer": (
                "Supabase shows up in the code as the place this app talks to for data or auth."
                if uses
                else "This scan did not find Supabase in the repository."
            ),
            "feature_id": (hit or {}).get("id"),
            "files": [],
        }
    if "break" in lowered or "change" in lowered:
        if hit:
            files = [str(step.get("file")) for step in hit.get("steps") or [] if step.get("file")]
            return {
                "answer": f"Changing {hit.get('name')} would touch {', '.join(files[:4]) or 'its primary files'}.",
                "feature_id": hit.get("id"),
                "files": files[:4],
            }
    if hit:
        return {
            "answer": str(hit.get("simple") or f"{hit.get('name')} is in the project."),
            "feature_id": hit.get("id"),
            "files": [str(step.get("file")) for step in hit.get("steps") or [] if step.get("file")][:4],
        }
    if issues and ("wrong" in lowered or "broken" in lowered or "issue" in lowered):
        first = issues[0]
        return {
            "answer": f"{first.get('title')}. {first.get('what')}",
            "feature_id": first.get("feature_id"),
            "files": first.get("evidence") or [],
        }
    purpose = guide.get("purpose") or "This is the scanned app."
    return {"answer": purpose, "feature_id": None, "files": []}


def self_test() -> int:
    login_src = (
        "export default function LoginPage() {\n"
        "  return <form><input type='password' /></form>;\n"
        "}\n"
    )
    auth_src = "export function signIn() { return true; }\n"
    dash_src = "export default function DashboardPage() { return <div>Home</div>; }\n"
    catalog = {
        "features": [
            {
                "feature_id": "authentication",
                "name": "Login",
                "description": "",
                "entry_points": ["/login"],
                "primary_files": ["app/login/page.tsx", "lib/auth.ts"],
                "verification_status": "failed",
                "verification": {
                    "tests": [
                        {
                            "id": "t1",
                            "name": "Login page loads",
                            "status": "pass",
                            "explanation": "The page returned 200.",
                            "source_candidates": ["app/login/page.tsx"],
                        }
                    ]
                },
            },
            {
                "feature_id": "dashboard",
                "name": "Dashboard",
                "entry_points": ["/dashboard"],
                "primary_files": ["app/dashboard/page.tsx"],
                "verification_status": "not_tested",
                "verification": {"tests": []},
            },
        ],
        "graph": {
            "nodes": [
                {"id": "app/login/page.tsx", "role": "page"},
                {"id": "lib/auth.ts", "role": "service"},
                {"id": "app/dashboard/page.tsx", "role": "page"},
            ],
            "edges": [
                {"source": "app/login/page.tsx", "target": "lib/auth.ts", "type": "calls"}
            ],
        },
        "file_index": {},
    }
    sources = {
        "app/login/page.tsx": login_src,
        "lib/auth.ts": auth_src,
        "app/dashboard/page.tsx": dash_src,
    }
    guide = build_vibe_guide(
        full_name="acme/TaskFlow",
        catalog=catalog,
        sources=sources,
        languages={"tsx": 3},
    )
    if guide["name"] != "TaskFlow":
        print("project name should come from the repo", file=sys.stderr)
        return 2
    if guide["counts"]["features"] != 2:
        print("guide should keep both features", file=sys.stderr)
        return 2
    login = next(item for item in guide["features"] if item["id"] == "authentication")
    titles = [step["title"] for step in login["steps"]]
    if not any("password" in title.lower() or "form" in title.lower() or "opens /login" in title.lower() for title in titles):
        print(f"login steps should come from the files, got {titles}", file=sys.stderr)
        return 2
    if any("check" in title.lower() and "password" in title.lower() for title in titles):
        print("must not invent a password check when auth.ts does not verify", file=sys.stderr)
        return 2
    if not any(item["id"] == "authentication-login-no-verify" for item in guide["issues"]):
        print("login without a verifier should be a needs-testing issue", file=sys.stderr)
        return 2
    asked = answer_question("How does login work?", guide)
    if asked.get("feature_id") != "authentication":
        print("login question should point at the login feature", file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, "selfTest": True}))
    return 0


def _llm_answer(question: str, guide: dict[str, Any], grounded: dict[str, Any]) -> dict[str, Any]:
    try:
        from llm_client import LlmClient, has_llm_config
    except Exception:
        return grounded
    if not has_llm_config():
        return grounded
    slim = {
        "purpose": guide.get("purpose"),
        "database": guide.get("database"),
        "integrations": guide.get("integrations"),
        "features": [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "simple": item.get("simple"),
                "entry_points": item.get("entry_points"),
                "steps": [
                    {"title": step.get("title"), "file": step.get("file")}
                    for step in item.get("steps") or []
                ],
            }
            for item in guide.get("features") or []
        ],
        "issues": guide.get("issues"),
    }
    prompt = (
        "Answer using only this guide. If the guide does not say, say you could not find it. "
        "Do not invent files or steps. Return JSON with answer, feature_id, files.\n"
        f"Question: {question}\nGuide: {json.dumps(slim)[:6000]}"
    )
    try:
        raw = LlmClient(timeout=20).generate(prompt, response_format="json", max_tokens=400)
        data = json.loads(raw)
    except Exception:
        return grounded
    if not isinstance(data, dict) or not str(data.get("answer") or "").strip():
        return grounded
    feature_id = data.get("feature_id") or grounded.get("feature_id")
    ids = {str(item.get("id")) for item in guide.get("features") or []}
    if feature_id and str(feature_id) not in ids:
        feature_id = grounded.get("feature_id")
    files = [str(item) for item in (data.get("files") or grounded.get("files") or []) if item]
    return {
        "answer": str(data.get("answer")).strip(),
        "feature_id": feature_id,
        "files": files[:6],
    }


def ask_guide(question: str, guide: dict[str, Any]) -> dict[str, Any]:
    grounded = answer_question(question, guide if isinstance(guide, dict) else {})
    return _llm_answer(question, guide if isinstance(guide, dict) else {}, grounded)


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        raise SystemExit(self_test())
    payload = json.loads(sys.stdin.read() or "{}")
    if payload.get("question") is not None:
        print(json.dumps(ask_guide(str(payload.get("question") or ""), payload.get("guide") or {})))
    else:
        print(json.dumps({"error": "Missing question."}))
        raise SystemExit(2)
