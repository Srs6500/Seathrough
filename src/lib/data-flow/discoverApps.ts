import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";

export type AppKind =
  | "nextjs"
  | "react"
  | "vite"
  | "express"
  | "fastapi"
  | "django"
  | "flask"
  | "python"
  | "go"
  | "unknown";

export type AppBadge = "supported" | "partial" | "later";

export type DetectedApp = {
  /** Directory containing the app; "" means repo root. */
  root: string;
  kind: AppKind;
  label: string;
  badge: AppBadge;
};

const NEXT_APP_FILE =
  /(?:^|\/)(?:src\/)?app\/(?:.+\/)?(?:page|layout|route)\.(tsx|jsx|ts|js)$/;
const PAGES_ROUTER =
  /(?:^|\/)(?:src\/)?pages\/(?!api\/).+\.(tsx|jsx|ts|js)$/;

function dirnameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

function addApp(map: Map<string, DetectedApp>, app: DetectedApp) {
  const key = `${app.kind}:${app.root}`;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, app);
    return;
  }
  const rank = { supported: 0, partial: 1, later: 2 };
  if (rank[app.badge] < rank[prev.badge]) map.set(key, app);
}

function packageRootFromMatch(path: string, matchedFrom: number): string {
  const before = path.slice(0, matchedFrom).replace(/\/$/, "");
  if (before.endsWith("/src")) return before.slice(0, -4);
  if (before === "src") return "";
  return before;
}

function nextRootFromPagePath(path: string): string | null {
  const appAt = path.search(NEXT_APP_FILE);
  if (appAt >= 0) return packageRootFromMatch(path, appAt);

  const pagesAt = path.search(PAGES_ROUTER);
  if (pagesAt >= 0) return packageRootFromMatch(path, pagesAt);
  return null;
}

function labelFor(kind: AppKind, root: string): string {
  const names: Record<AppKind, string> = {
    nextjs: "Next.js",
    react: "React",
    vite: "Vite · React",
    express: "Node · Express",
    fastapi: "Python · FastAPI",
    django: "Python · Django",
    flask: "Python · Flask",
    python: "Python",
    go: "Go",
    unknown: "Unknown",
  };
  const base = names[kind];
  return root ? `${base} (${root})` : base;
}

function badgeFor(kind: AppKind): AppBadge {
  if (kind === "nextjs") return "supported";
  if (
    kind === "react" ||
    kind === "vite" ||
    kind === "express" ||
    kind === "fastapi" ||
    kind === "go"
  ) {
    return "partial";
  }
  return "later";
}

/** Infer apps from git paths only (no file downloads). */
export function inferAppsFromPaths(paths: string[]): DetectedApp[] {
  const map = new Map<string, DetectedApp>();
  for (const path of paths) {
    const nextRoot = nextRootFromPagePath(path);
    if (nextRoot != null) {
      addApp(map, {
        root: nextRoot,
        kind: "nextjs",
        label: labelFor("nextjs", nextRoot),
        badge: "supported",
      });
    }
    if (/(^|\/)go\.mod$/.test(path)) {
      const root = dirnameOf(path);
      addApp(map, {
        root,
        kind: "go",
        label: labelFor("go", root),
        badge: "partial",
      });
    }
    if (/(^|\/)(requirements\.txt|pyproject\.toml)$/.test(path)) {
      const root = dirnameOf(path);
      addApp(map, {
        root,
        kind: "python",
        label: labelFor("python", root),
        badge: "later",
      });
    }
    if (/(^|\/)vite\.config\.(ts|js|mts|mjs)$/.test(path)) {
      const root = dirnameOf(path);
      addApp(map, {
        root,
        kind: "vite",
        label: labelFor("vite", root),
        badge: "partial",
      });
    }
  }
  return [...map.values()];
}

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

function depsOf(pkg: PkgJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

function kindFromPackageJson(raw: string): AppKind | null {
  try {
    const pkg = JSON.parse(raw) as PkgJson;
    const deps = depsOf(pkg);
    if (deps.next) return "nextjs";
    if (deps.vite || deps["@vitejs/plugin-react"]) return "vite";
    if (deps.express || deps.fastify || deps.koa) return "express";
    if (deps.react) return "react";
    return null;
  } catch {
    return null;
  }
}

function kindFromPythonManifest(raw: string): AppKind {
  const blob = raw.toLowerCase();
  if (blob.includes("fastapi")) return "fastapi";
  if (blob.includes("django")) return "django";
  if (blob.includes("flask")) return "flask";
  return "python";
}

/** Refine path-inferred apps using downloaded manifests. */
export function refineAppsFromManifests(
  manifests: RepoSourceFile[],
  pathApps: DetectedApp[] = [],
): DetectedApp[] {
  const map = new Map<string, DetectedApp>();
  for (const app of pathApps) addApp(map, app);

  for (const file of manifests) {
    const base = file.path.split("/").pop() ?? file.path;
    const root = dirnameOf(file.path);

    if (base === "package.json") {
      const kind = kindFromPackageJson(file.content);
      if (!kind) continue;
      addApp(map, {
        root,
        kind,
        label: labelFor(kind, root),
        badge: badgeFor(kind),
      });
    }

    if (base === "requirements.txt" || base === "pyproject.toml") {
      const kind = kindFromPythonManifest(file.content);
      if (kind !== "python") map.delete(`python:${root}`);
      addApp(map, {
        root,
        kind,
        label: labelFor(kind, root),
        badge: badgeFor(kind),
      });
    }

    if (base === "go.mod") {
      addApp(map, {
        root,
        kind: "go",
        label: labelFor("go", root),
        badge: "partial",
      });
    }
  }

  return [...map.values()].sort((a, b) =>
    a.root.localeCompare(b.root) || a.kind.localeCompare(b.kind),
  );
}

export function formatStackLabel(apps: DetectedApp[]): string {
  if (apps.length === 0) return "Unknown stack";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const app of apps) {
    if (seen.has(app.label)) continue;
    seen.add(app.label);
    parts.push(app.label);
  }
  return parts.slice(0, 4).join(" · ");
}

export function stackBadge(
  apps: DetectedApp[],
): "supported" | "later" {
  if (apps.some((a) => a.kind === "nextjs" || a.badge === "supported")) {
    return "supported";
  }
  if (apps.some((a) => a.badge === "partial")) return "supported";
  return "later";
}

export function isManifestPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return (
    base === "package.json" ||
    base === "tsconfig.json" ||
    base === "jsconfig.json" ||
    base === "go.mod" ||
    base === "requirements.txt" ||
    base === "pyproject.toml"
  );
}

/** Roots we should prefer when downloading source (Next/API apps). */
export function preferredRoots(apps: DetectedApp[]): string[] {
  const roots = apps
    .filter(
      (a) =>
        a.kind === "nextjs" ||
        a.kind === "vite" ||
        a.kind === "react" ||
        a.kind === "express" ||
        a.kind === "fastapi" ||
        a.kind === "go",
    )
    .map((a) => a.root);
  return [...new Set(roots)];
}

export function pathInRoot(path: string, root: string): boolean {
  if (!root) return true;
  return path === root || path.startsWith(`${root}/`);
}

/** Nearest directory that contains package.json (for @/ imports). */
export function nearestPackageRoot(
  fromPath: string,
  pathSet: Set<string>,
): string {
  const parts = fromPath.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i).join("/");
    const pkg = dir ? `${dir}/package.json` : "package.json";
    if (pathSet.has(pkg)) return dir;
  }
  return "";
}

export function describeUnknownStack(apps: DetectedApp[]): string {
  if (apps.length === 0) {
    return "No Next.js, React, Express, FastAPI, or Go app was detected in this repository.";
  }
  const labels = apps.map((a) => a.label).join(", ");
  const indexed = apps.filter((a) => a.badge !== "later");
  if (indexed.length === 0) {
    return `Detected ${labels}. This stack is listed but not fully indexed yet — Next.js, React, Express, FastAPI, and Go routes are supported.`;
  }
  return `Detected ${labels}.`;
}

/** Higher score → download first when the file cap is hit. */
export function fetchPriorityScore(path: string, roots: string[]): number {
  let s = 0;
  if (isManifestPath(path)) s += 40;
  if (roots.length > 0 && roots.some((root) => pathInRoot(path, root))) s += 16;
  if (NEXT_APP_FILE.test(path)) s += 28;
  if (PAGES_ROUTER.test(path)) s += 22;
  if (/(^|\/)(src|app|pages|components|ui|views|screens|modules|api|routers|internal|cmd)\//i.test(path)) {
    s += 3;
  }
  if (/\.(tsx|jsx)$/i.test(path)) s += 3;
  if (/\.(py|go)$/i.test(path)) s += 2;
  if (/(login|auth|search|form|nav|dashboard|checkout|profile|handler|router)/i.test(path)) {
    s += 2;
  }
  return s;
}
