import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type DevKind = "next" | "vite" | "cra" | "script";

export type PackageJson = {
  name?: string;
  workspaces?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type DetectedDevApp = {
  appRoot: string;
  relativeRoot: string;
  installRoot: string;
  kind: DevKind;
  script: string | null;
  packageName: string | null;
};

export type PackageManager = {
  name: "pnpm" | "yarn" | "npm";
  install: { command: string; args: string[] };
};

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".seethrough",
  "vendor",
  "out",
  ".cache",
  "tmp",
  "__pycache__",
]);

function depsOf(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

export function classifyPackage(pkg: PackageJson): {
  score: number;
  kind: DevKind | null;
  script: string | null;
} {
  const deps = depsOf(pkg);
  const scripts = pkg.scripts ?? {};
  const script = scripts.dev ? "dev" : scripts.start ? "start" : null;

  if (deps.next) {
    return { score: 100, kind: "next", script: scripts.dev ? "dev" : script };
  }
  if (deps.vite || deps["@vitejs/plugin-react"] || deps["@vitejs/plugin-vue"]) {
    return { score: 90, kind: "vite", script: scripts.dev ? "dev" : script };
  }
  if (deps["react-scripts"]) {
    return { score: 80, kind: "cra", script: scripts.start ? "start" : script };
  }
  if (deps.react && script) {
    return { score: 70, kind: "script", script };
  }
  if (script) {
    return { score: 45, kind: "script", script };
  }
  return { score: 0, kind: null, script: null };
}

function pathBonus(relativeRoot: string): number {
  if (relativeRoot === ".") return 8;
  const lower = relativeRoot.toLowerCase();
  if (/(^|\/)(web|frontend|client|ui)(\/|$)/.test(lower)) return 16;
  if (/(^|\/)apps\/(web|frontend|site)(\/|$)/.test(lower)) return 14;
  if (/(^|\/)app(\/|$)/.test(lower)) return 6;
  return 0;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function readPackageJson(dir: string): Promise<PackageJson | null> {
  try {
    const raw = await readFile(path.join(dir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as PackageJson;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function collectPackageDirs(
  root: string,
  depth: number,
  maxDepth: number,
): Promise<string[]> {
  const found: string[] = [];
  if (await fileExists(path.join(root, "package.json"))) found.push(root);
  if (depth >= maxDepth) return found;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    found.push(
      ...(await collectPackageDirs(
        path.join(root, entry.name),
        depth + 1,
        maxDepth,
      )),
    );
  }
  return found;
}

export async function findDevApp(work: string): Promise<DetectedDevApp | null> {
  const dirs = await collectPackageDirs(work, 0, 4);
  let best: {
    dir: string;
    score: number;
    kind: DevKind;
    script: string | null;
    pkg: PackageJson;
  } | null = null;

  for (const dir of dirs) {
    const pkg = await readPackageJson(dir);
    if (!pkg) continue;
    const classified = classifyPackage(pkg);
    if (!classified.kind) continue;
    const relativeRoot = path.relative(work, dir) || ".";
    const depth = relativeRoot === "." ? 0 : relativeRoot.split("/").length;
    const score =
      classified.score + pathBonus(relativeRoot) - depth * 3;
    if (!best || score > best.score) {
      best = {
        dir,
        score,
        kind: classified.kind,
        script: classified.script,
        pkg,
      };
    }
  }

  if (!best) return null;

  const relativeRoot = path.relative(work, best.dir) || ".";
  const rootPkg = await readPackageJson(work);
  const workspaces = Boolean(rootPkg?.workspaces);
  const installRoot =
    workspaces || relativeRoot === "." ? work : best.dir;

  return {
    appRoot: best.dir,
    relativeRoot,
    installRoot,
    kind: best.kind,
    script: best.script,
    packageName: typeof best.pkg.name === "string" ? best.pkg.name : null,
  };
}

export async function detectPackageManager(
  dir: string,
): Promise<PackageManager> {
  if (await fileExists(path.join(dir, "pnpm-lock.yaml"))) {
    return {
      name: "pnpm",
      install: { command: "pnpm", args: ["install"] },
    };
  }
  if (
    (await fileExists(path.join(dir, "yarn.lock"))) ||
    (await fileExists(path.join(dir, ".yarnrc.yml")))
  ) {
    return {
      name: "yarn",
      install: { command: "yarn", args: ["install"] },
    };
  }
  return {
    name: "npm",
    install: { command: "npm", args: ["install", "--no-fund", "--no-audit"] },
  };
}

export function devCommand(
  kind: DevKind,
  pm: PackageManager,
  port: number,
  script: string | null,
): { command: string; args: string[] } {
  const portStr = String(port);
  if (kind === "next") {
    if (pm.name === "pnpm") {
      return {
        command: "pnpm",
        args: ["exec", "next", "dev", "--port", portStr, "--hostname", "127.0.0.1"],
      };
    }
    if (pm.name === "yarn") {
      return {
        command: "yarn",
        args: ["next", "dev", "--port", portStr, "--hostname", "127.0.0.1"],
      };
    }
    return {
      command: "npx",
      args: ["next", "dev", "--port", portStr, "--hostname", "127.0.0.1"],
    };
  }

  if (kind === "vite") {
    if (pm.name === "pnpm") {
      return {
        command: "pnpm",
        args: ["exec", "vite", "--port", portStr, "--host", "127.0.0.1"],
      };
    }
    if (pm.name === "yarn") {
      return {
        command: "yarn",
        args: ["vite", "--port", portStr, "--host", "127.0.0.1"],
      };
    }
    return {
      command: "npx",
      args: ["vite", "--port", portStr, "--host", "127.0.0.1"],
    };
  }

  const runScript = script ?? (kind === "cra" ? "start" : "dev");
  if (pm.name === "pnpm") {
    return {
      command: "pnpm",
      args: ["run", runScript, "--", "--port", portStr, "--host", "127.0.0.1"],
    };
  }
  if (pm.name === "yarn") {
    return {
      command: "yarn",
      args: [runScript, "--port", portStr, "--host", "127.0.0.1"],
    };
  }
  return {
    command: "npm",
    args: ["run", runScript, "--", "--port", portStr, "--host", "127.0.0.1"],
  };
}

export function looksReady(text: string): boolean {
  return /ready|started server|local:|compiled successfully|localhost:\d+/i.test(
    text,
  );
}
