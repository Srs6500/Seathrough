import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type PreviewPage = {
  route: string;
  name: string;
  file: string;
  auth: boolean;
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
  ".seethrough-pages",
  "vendor",
  "out",
  ".cache",
  "tmp",
  "__pycache__",
]);

const ROUTE_JSX = /<Route\b[^>]*\bpath=\{?['"`]([^'"`]+)['"`]/g;
const ROUTE_OBJ = /\bpath:\s*['"`]([^'"`]+)['"`]/g;

export function isAuthRoute(route: string): boolean {
  return /(?:^|\/)(login|log-in|signin|sign-in|signup|sign-up|register|join)(?:\/|$)/i.test(
    route,
  );
}

export function isSkippableRoute(route: string): boolean {
  if (!route.startsWith("/")) return true;
  if (route.startsWith("/api")) return true;
  if (route.includes(":")) return true;
  if (route.includes("*")) return true;
  if (route.includes("[")) return true;
  return false;
}

export function routeName(route: string): string {
  if (route === "/") return "Home";
  const last = route.split("/").filter(Boolean).pop() || "Page";
  const pretty = last.replace(/[-_]+/g, " ");
  if (/^log[\s-]?in$/i.test(pretty)) return "Log in";
  if (/^sign[\s-]?in$/i.test(pretty)) return "Sign in";
  if (/^sign[\s-]?up$/i.test(pretty)) return "Sign up";
  return pretty.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function fileToRoute(relPath: string): string | null {
  const normalized = relPath.replaceAll("\\", "/");

  if (/(?:^|\/)app\/page\.(tsx|jsx|ts|js)$/.test(normalized)) return "/";

  const appPage = normalized.match(/(?:^|\/)app\/(.+)\/page\.(tsx|jsx|ts|js)$/);
  if (appPage) {
    const segs = appPage[1]!
      .split("/")
      .filter((seg) => seg && !seg.startsWith("(") && !seg.startsWith("@"))
      .map((seg) =>
        seg.startsWith("[") ? `:${seg.replace(/[[\]\.]/g, "")}` : seg,
      );
    const route = `/${segs.join("/")}`;
    return route === "/" ? "/" : route.replace(/\/$/, "");
  }

  const pagesPage = normalized.match(/(?:^|\/)pages\/(.+)\.(tsx|jsx|ts|js)$/);
  if (pagesPage) {
    const page = pagesPage[1]!;
    if (page.startsWith("api/")) return null;
    if (page === "_app" || page === "_document" || page === "_error") return null;
    if (page === "index") return "/";
    return `/${page.replace(/\/index$/, "").replace(/\[(.+?)\]/g, ":$1")}`;
  }

  const vitePage = normalized.match(/(?:^|\/)src\/pages\/(.+)\.(tsx|jsx)$/);
  if (vitePage) {
    const page = vitePage[1]!;
    if (page === "index") return "/";
    return `/${page.replace(/\/index$/, "")}`;
  }

  return null;
}

function normalizeRoute(route: string): string | null {
  const trimmed = route.trim() || "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const clean = withSlash.replace(/\/+/g, "/");
  if (isSkippableRoute(clean)) return null;
  if (clean !== "/" && clean.endsWith("/")) return clean.slice(0, -1);
  return clean;
}

function addPage(
  byRoute: Map<string, PreviewPage>,
  route: string,
  file: string,
) {
  const clean = normalizeRoute(route);
  if (!clean) return;
  if (byRoute.has(clean)) return;
  byRoute.set(clean, {
    route: clean,
    name: routeName(clean),
    file,
    auth: isAuthRoute(clean),
  });
}

async function collectFiles(
  root: string,
  rel: string,
  depth: number,
  maxDepth: number,
  out: string[],
): Promise<void> {
  if (depth > maxDepth || out.length > 400) return;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(rel ? path.join(root, rel) : root, {
      withFileTypes: true,
    });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collectFiles(root, nextRel, depth + 1, maxDepth, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(tsx|jsx|ts|js)$/.test(entry.name)) continue;
    out.push(nextRel);
  }
}

export function loginRouteOf(pages: PreviewPage[]): string | null {
  const ranked = pages
    .filter((page) => page.auth)
    .sort((a, b) => a.route.length - b.route.length);
  return ranked[0]?.route ?? null;
}

export function sortPreviewPages(pages: PreviewPage[]): PreviewPage[] {
  return [...pages].sort((a, b) => {
    if (a.route === "/" && b.route !== "/") return -1;
    if (b.route === "/" && a.route !== "/") return 1;
    if (a.auth !== b.auth) return a.auth ? -1 : 1;
    return a.route.localeCompare(b.route);
  });
}

export async function discoverPreviewPages(
  appRootAbs: string,
): Promise<PreviewPage[]> {
  const files: string[] = [];
  await collectFiles(appRootAbs, "", 0, 6, files);
  const byRoute = new Map<string, PreviewPage>();

  for (const file of files) {
    const fromPath = fileToRoute(file);
    if (fromPath) addPage(byRoute, fromPath, file);
  }

  const routerFiles = files.filter(
    (file) =>
      /\.(tsx|jsx|ts|js)$/.test(file) &&
      !file.includes("node_modules") &&
      (file.endsWith("App.tsx") ||
        file.endsWith("App.jsx") ||
        file.includes("routes") ||
        file.includes("router")),
  );

  for (const file of routerFiles.slice(0, 40)) {
    let content = "";
    try {
      content = await readFile(path.join(appRootAbs, file), "utf8");
    } catch {
      continue;
    }
    if (!/react-router|createBrowserRouter|<Route\b/.test(content)) continue;
    ROUTE_JSX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ROUTE_JSX.exec(content)) !== null) {
      addPage(byRoute, match[1]!, file);
    }
    if (/createBrowserRouter|createRoutesFromElements/.test(content)) {
      ROUTE_OBJ.lastIndex = 0;
      while ((match = ROUTE_OBJ.exec(content)) !== null) {
        addPage(byRoute, match[1]!, file);
      }
    }
  }

  const pages = sortPreviewPages([...byRoute.values()]).slice(0, 16);
  if (pages.length === 0) {
    return [
      {
        route: "/",
        name: "Home",
        file: "",
        auth: false,
      },
    ];
  }
  return pages;
}
