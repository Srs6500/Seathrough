import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import type {
  IndexedEdge,
  IndexedSymbol,
  RepoIndex,
} from "@/lib/data-flow/types";

function lineOf(content: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function snippetAround(content: string, startLine: number, endLine: number): string {
  const lines = content.split("\n");
  const from = Math.max(0, startLine - 1);
  const to = Math.min(lines.length, endLine);
  return lines.slice(from, to).join("\n").slice(0, 280);
}

function tokenize(...parts: string[]): string[] {
  const set = new Set<string>();
  for (const part of parts) {
    for (const token of part
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((t) => t.length > 2)) {
      set.add(token);
    }
  }
  return [...set];
}

function pathToRoute(path: string): string | undefined {
  // app router page
  const appPage = path.match(/(?:^|\/)app\/(.+)\/page\.(tsx|jsx|ts|js)$/);
  if (appPage) {
    const segs = appPage[1]!
      .split("/")
      .filter((s) => s && !s.startsWith("(") && !s.startsWith("@"))
      .map((s) => (s.startsWith("[") ? `:${s.replace(/[\[\]\.]/g, "")}` : s));
    return "/" + segs.join("/");
  }
  if (/(?:^|\/)app\/page\.(tsx|jsx|ts|js)$/.test(path)) return "/";

  const appRoute = path.match(/(?:^|\/)app\/(.+)\/route\.(ts|js)$/);
  if (appRoute) {
    const segs = appRoute[1]!
      .split("/")
      .filter((s) => s && !s.startsWith("("))
      .map((s) => (s.startsWith("[") ? `:${s.replace(/[\[\]\.]/g, "")}` : s));
    return "/api/" + segs.filter((s) => s !== "api").join("/").replace(/^api\//, "");
  }

  // pages router
  const pagesApi = path.match(/(?:^|\/)pages\/api\/(.+)\.(ts|js)$/);
  if (pagesApi) return "/api/" + pagesApi[1]!.replace(/\/index$/, "");

  const pagesPage = path.match(/(?:^|\/)pages\/(.+)\.(tsx|jsx|ts|js)$/);
  if (pagesPage) {
    const p = pagesPage[1]!;
    if (p.startsWith("api/")) return undefined;
    if (p === "index") return "/";
    return "/" + p.replace(/\/index$/, "").replace(/\[(.+?)\]/g, ":$1");
  }
  return undefined;
}

function fixApiRoute(path: string, rough: string | undefined): string | undefined {
  if (!rough) return undefined;
  if (/\/route\.(ts|js)$/.test(path)) {
    const m = path.match(/(?:^|\/)app\/(.*)\/route\.(ts|js)$/);
    if (!m) return rough;
    const segs = m[1]!
      .split("/")
      .filter((s) => s && !s.startsWith("(") && !s.startsWith("@"))
      .map((s) => (s.startsWith("[") ? `:${s.replace(/[\[\]\.]/g, "")}` : s));
    return "/" + segs.join("/");
  }
  return rough;
}

function detectFramework(files: RepoSourceFile[]): {
  ok: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const pkg = files.find((f) => f.path === "package.json" || f.path.endsWith("/package.json"));
  let hasNext = false;
  let hasTs = false;
  if (pkg) {
    try {
      const json = JSON.parse(pkg.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...json.dependencies, ...json.devDependencies };
      hasNext = Boolean(deps.next);
      hasTs = Boolean(
        deps.typescript ||
          files.some((f) => f.path.endsWith("tsconfig.json")),
      );
    } catch {
      warnings.push("Could not parse package.json.");
    }
  }
  const hasApp =
    files.some((f) => /(^|\/)app\/.*page\.(tsx|jsx|ts|js)$/.test(f.path)) ||
    files.some((f) => /(^|\/)pages\/.+\.(tsx|jsx)$/.test(f.path));
  if (!hasNext && !hasApp) {
    return {
      ok: false,
      warnings: [
        "This looks unlike a Next.js app (no next dependency or app/pages routes). Only TypeScript + Next.js is supported for now.",
      ],
    };
  }
  if (!hasTs && !files.some((f) => /\.tsx?$/.test(f.path))) {
    warnings.push("Little TypeScript found; results may be incomplete.");
  }
  if (!hasNext && hasApp) {
    warnings.push("Treating as Next.js from app/pages layout (next not seen in scanned package.json).");
  }
  return { ok: true, warnings };
}

function symbolId(kind: string, path: string, name?: string): string {
  const base = `${kind}:${path}${name ? `#${name}` : ""}`;
  return base.toLowerCase().replace(/[^a-z0-9:/._#-]+/g, "-");
}

function extractExportNames(content: string): string[] {
  const names: string[] = [];
  const re =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) names.push(m[1]!);
  const def = content.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/);
  if (def) names.push(def[1]!);
  return [...new Set(names)];
}

function classifyFile(path: string): IndexedSymbol["kind"] | null {
  if (/(^|\/)app\/.*\/page\.(tsx|jsx|ts|js)$/.test(path) || /(^|\/)app\/page\.(tsx|jsx|ts|js)$/.test(path))
    return "page";
  if (/(^|\/)pages\/(?!api\/).+\.(tsx|jsx|ts|js)$/.test(path)) return "page";
  if (/(^|\/)app\/.*\/route\.(ts|js)$/.test(path) || /(^|\/)pages\/api\//.test(path))
    return "api";
  if (
    /(prisma|drizzle|supabase|mongoose|typeorm|sequelize|knex)/i.test(path) ||
    /(^|\/)(lib|src)\/.*(db|database|prisma|supabase)\.(ts|js)$/i.test(path)
  )
    return "database";
  if (/(^|\/)(components|ui|features)\//.test(path) && /\.(tsx|jsx)$/.test(path))
    return "component";
  if (/\.(tsx|jsx)$/.test(path)) return "component";
  if (/\.(ts|js)$/.test(path) && !path.endsWith(".d.ts")) return "lib";
  return null;
}

function isDatabaseContent(content: string, path: string): boolean {
  if (classifyFile(path) === "database") return true;
  return (
    /\b(prisma|drizzle|createClient|supabase|mongoose|sql`|from\(["'`]\w+)/i.test(
      content,
    ) &&
    /\b(insert|update|delete|findMany|findUnique|\.from\(|\.select\()/i.test(
      content,
    )
  );
}

/** Resolve ./ and ../ imports relative to importer path. */
export function resolveImportPath(
  fromPath: string,
  spec: string,
  pathSet: Set<string>,
): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) {
    return null;
  }
  let abs: string;
  if (spec.startsWith("@/")) {
    // Prefer src/ then root
    const rest = spec.slice(2);
    const candidates = [`src/${rest}`, rest, `app/${rest}`];
    abs = candidates[0]!;
    for (const c of candidates) {
      const hit = matchFile(c, pathSet);
      if (hit) return hit;
    }
    return matchFile(abs, pathSet);
  }
  const dir = fromPath.includes("/")
    ? fromPath.slice(0, fromPath.lastIndexOf("/"))
    : "";
  const joined = (dir ? `${dir}/` : "") + spec;
  const parts = joined.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return matchFile(out.join("/"), pathSet);
}

function matchFile(base: string, pathSet: Set<string>): string | null {
  const cleaned = base.replace(/^\.\//, "");
  const tries = [
    cleaned,
    `${cleaned}.ts`,
    `${cleaned}.tsx`,
    `${cleaned}.js`,
    `${cleaned}.jsx`,
    `${cleaned}/index.ts`,
    `${cleaned}/index.tsx`,
    `${cleaned}/page.tsx`,
    `${cleaned}/route.ts`,
  ];
  for (const t of tries) {
    if (pathSet.has(t)) return t;
  }
  // Case-insensitive fallback
  const lower = cleaned.toLowerCase();
  for (const p of pathSet) {
    if (
      p.toLowerCase() === lower ||
      p.toLowerCase() === `${lower}.ts` ||
      p.toLowerCase() === `${lower}.tsx` ||
      p.toLowerCase() === `${lower}/index.ts` ||
      p.toLowerCase() === `${lower}/index.tsx`
    ) {
      return p;
    }
  }
  return null;
}

function findApiCalls(content: string): Array<{ route: string; index: number }> {
  const out: Array<{ route: string; index: number }> = [];
  const re =
    /fetch\(\s*[`'"](\/api\/[^`'"]+)[`'"]|axios\.\w+\(\s*[`'"](\/api\/[^`'"]+)[`'"]|['"](\/api\/[^'"]+)['"]\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const route = (m[1] || m[2] || m[3] || "").split("?")[0]!;
    if (route) out.push({ route, index: m.index });
  }
  return out;
}

function findHrefLinks(content: string): Array<{ href: string; index: number }> {
  const out: Array<{ href: string; index: number }> = [];
  const re = /(?:href|pathname)=\{?[`'"](\/[^`'"]+)[`'"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({ href: m[1]!.split("?")[0]!, index: m.index });
  }
  return out;
}

/**
 * Build a static Next.js / TypeScript index: pages, components, API routes,
 * database modules, and confirmed/guess edges between them.
 */
export function buildNextIndex(files: RepoSourceFile[]): RepoIndex {
  const framework = detectFramework(files);
  if (!framework.ok) {
    return {
      frameworkOk: false,
      warnings: framework.warnings,
      symbols: [],
      edges: [],
    };
  }

  const pathSet = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const symbols: IndexedSymbol[] = [];
  const pathToSymbolId = new Map<string, string>();

  for (const file of files) {
    let kind = classifyFile(file.path);
    if (!kind) continue;
    if (kind === "lib" && isDatabaseContent(file.content, file.path)) {
      kind = "database";
    }
    if (kind === "component" && isDatabaseContent(file.content, file.path)) {
      // keep component unless it's clearly a db module path
    }

    const names = extractExportNames(file.content);
    const route = fixApiRoute(file.path, pathToRoute(file.path));
    const httpOnly = names.filter((n) =>
      /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(n),
    );
    const prettyNames = names.filter(
      (n) => !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|default)$/.test(n),
    );
    const title =
      (route
        ? kind === "api"
          ? `API ${route}${httpOnly.length ? ` (${httpOnly.join(", ")})` : ""}`
          : kind === "page"
            ? `Page ${route === "/" ? "home" : route}`
            : null
        : null) ||
      prettyNames[0] ||
      names[0] ||
      file.path.split("/").pop() ||
      file.path;

    const startLine = 1;
    const endLine = Math.min(40, file.content.split("\n").length);
    const id = symbolId(kind, file.path, names[0]);
    pathToSymbolId.set(file.path, id);

    symbols.push({
      id,
      kind,
      title,
      path: file.path,
      startLine,
      endLine,
      snippet: snippetAround(file.content, startLine, endLine),
      tokens: tokenize(file.path, title, route ?? "", names.join(" "), file.content.slice(0, 2000)),
      route,
      names,
    });

    // Also register database hits inside API files as related DB symbols
    if (kind === "api" && isDatabaseContent(file.content, file.path)) {
      const dbMatch = file.content.match(
        /\b(prisma|supabase|db|drizzle)\b[\s\S]{0,80}/i,
      );
      if (dbMatch && dbMatch.index != null) {
        const line = lineOf(file.content, dbMatch.index);
        const dbId = symbolId("database", file.path, "inline-db");
        symbols.push({
          id: dbId,
          kind: "database",
          title: "Database access",
          path: file.path,
          startLine: line,
          endLine: Math.min(line + 12, file.content.split("\n").length),
          snippet: snippetAround(file.content, line, line + 12),
          tokens: tokenize(file.path, "database", "prisma", "supabase", "db"),
          names: ["database"],
        });
      }
    }
  }

  const edges: IndexedEdge[] = [];
  const edgeKey = new Set<string>();
  const addEdge = (edge: IndexedEdge) => {
    const key = `${edge.fromId}->${edge.toId}:${edge.label ?? ""}`;
    if (edgeKey.has(key)) return;
    if (edge.fromId === edge.toId) return;
    edgeKey.add(key);
    edges.push(edge);
  };

  const routeToApiId = new Map<string, string>();
  const routeToPageId = new Map<string, string>();
  for (const s of symbols) {
    if (!s.route) continue;
    if (s.kind === "api") routeToApiId.set(s.route, s.id);
    if (s.kind === "page") routeToPageId.set(s.route, s.id);
  }

  for (const file of files) {
    const fromId = pathToSymbolId.get(file.path);
    if (!fromId) continue;

    // Import edges (confirmed)
    const importRe =
      /import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(file.content)) !== null) {
      const spec = im[1] || im[2];
      if (!spec) continue;
      const resolved = resolveImportPath(file.path, spec, pathSet);
      if (!resolved) continue;
      const toId = pathToSymbolId.get(resolved);
      if (!toId) continue;
      addEdge({
        fromId,
        toId,
        label: "imports",
        certainty: "confirmed",
        reason: `Import of ${spec} in ${file.path}`,
      });
    }

    // fetch('/api/...') — confirmed if route exists, else guess
    for (const call of findApiCalls(file.content)) {
      const line = lineOf(file.content, call.index);
      let toId = routeToApiId.get(call.route);
      // fuzzy: /api/orders vs /api/orders/[id]
      if (!toId) {
        for (const [route, id] of routeToApiId) {
          if (
            call.route === route ||
            call.route.startsWith(route + "/") ||
            route.startsWith(call.route)
          ) {
            toId = id;
            break;
          }
        }
      }
      if (toId) {
        addEdge({
          fromId,
          toId,
          label: `calls ${call.route}`,
          certainty: "confirmed",
          reason: `fetch/API string ${call.route} at line ${line}`,
        });
      } else {
        // Guesses: point to any API symbol with overlapping tokens
        const guess = symbols.find(
          (s) =>
            s.kind === "api" &&
            s.route &&
            call.route.includes(s.route.replace(/^\/api\//, "").split("/")[0] ?? "___"),
        );
        if (guess) {
          addEdge({
            fromId,
            toId: guess.id,
            label: `calls ${call.route}?`,
            certainty: "guess",
            reason: `API path ${call.route} did not match exactly; guessed ${guess.route}`,
          });
        }
      }
    }

    // Link href → page (confirmed when page exists)
    for (const link of findHrefLinks(file.content)) {
      const toId = routeToPageId.get(link.href);
      if (!toId) continue;
      addEdge({
        fromId,
        toId,
        label: `links ${link.href}`,
        certainty: "confirmed",
        reason: `href ${link.href}`,
      });
    }

    // Form action="/api/..." guess/confirmed
    const actionRe = /action=\{?[`'"](\/api\/[^`'"]+)[`'"]/g;
    let am: RegExpExecArray | null;
    while ((am = actionRe.exec(file.content)) !== null) {
      const route = am[1]!.split("?")[0]!;
      const toId = routeToApiId.get(route);
      if (!toId) continue;
      addEdge({
        fromId,
        toId,
        label: "form action",
        certainty: "confirmed",
        reason: `form action ${route}`,
      });
    }
  }

  // Page → child component: if page imports component, already covered.
  // API → database: if api file has inline db symbol, link them
  for (const s of symbols) {
    if (s.kind !== "database" || !s.id.includes("inline-db")) continue;
    const apiId = pathToSymbolId.get(s.path);
    if (!apiId) continue;
    addEdge({
      fromId: apiId,
      toId: s.id,
      label: "reads/writes",
      certainty: "confirmed",
      reason: "Database client usage in the same API route file",
    });
  }

  // Guess: API imports a db lib
  for (const edge of [...edges]) {
    const from = symbols.find((s) => s.id === edge.fromId);
    const to = symbols.find((s) => s.id === edge.toId);
    if (from?.kind === "api" && to?.kind === "lib" && /db|prisma|supabase|database/i.test(to.path + to.title)) {
      // upgrade target conceptually — leave as is; add parallel db edge if we reclassify
    }
  }

  // Promote imported db libs
  for (const s of symbols) {
    if (s.kind !== "lib") continue;
    const file = byPath.get(s.path);
    if (!file || !isDatabaseContent(file.content, file.path)) continue;
    s.kind = "database";
    s.title = s.title.match(/db|prisma|supabase/i) ? s.title : `${s.title} (db)`;
  }

  return {
    frameworkOk: true,
    warnings: framework.warnings,
    symbols,
    edges,
  };
}
