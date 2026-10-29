import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import {
  attachArchitectureAnalysis,
  type ArchitectureReport,
} from "@/lib/bug-analyzer/analyzeLogicalGaps";
import { analyzeNextRepo, type RepoAnalysis } from "@/lib/bug-analyzer/analyzeRepo";
import { getLlmConfig } from "@/lib/env";
import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";

/** Compact knowledge record for a symbol (function / component / page / …). */
export const knowledgeRecordSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "page",
    "component",
    "function",
    "hook",
    "service",
    "api",
    "other",
  ]),
  name: z.string().min(1),
  file: z.string().min(1),
  signature: z.string().min(1),
  purpose: z.string().min(1),
  calls: z.array(z.string()).max(20),
  used_by: z.array(z.string()).max(20),
  related_pages: z.array(z.string()).max(12),
  confidence: z.enum(["high", "medium", "low"]),
  source_hash: z.string().min(1),
});

export const pageSummarySchema = z.object({
  route: z.string().min(1),
  purpose: z.string().min(1),
  components: z.array(z.string()).max(20),
  functions: z.array(z.string()).max(20),
  related_services: z.array(z.string()).max(12),
  summary: z.string().min(1),
  file: z.string().optional(),
});

export const flowNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum([
    "page",
    "component",
    "function",
    "hook",
    "service",
    "api",
    "other",
  ]),
  file: z.string().optional(),
});

export const featureFlowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().min(1),
  nodes: z.array(flowNodeSchema).min(1).max(12),
  explanation: z.string().min(1),
});

/** Legacy flat row for the table view. */
export const dataIndexElementSchema = z.object({
  name: z.string().min(1),
  kind: knowledgeRecordSchema.shape.type,
  path: z.string().min(1),
  purpose: z.string().min(1),
  connections: z.array(z.string().min(1)).max(12),
});

export const dataIndexSchema = z.object({
  elements: z.array(dataIndexElementSchema).max(80).optional(),
  records: z.array(knowledgeRecordSchema).max(120).optional(),
  pages: z.array(pageSummarySchema).max(40).optional(),
  features: z.array(featureFlowSchema).max(80).optional(),
});

export type KnowledgeRecord = z.infer<typeof knowledgeRecordSchema>;
export type PageSummary = z.infer<typeof pageSummarySchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FeatureFlow = z.infer<typeof featureFlowSchema>;
export type DataIndexElement = z.infer<typeof dataIndexElementSchema>;

export type DataIndex = {
  fullName: string;
  ref: string;
  scope: "file" | "repo";
  focusPath: string | null;
  source: "ai" | "heuristic";
  status: "indexed" | "partial";
  appName: string;
  elements: DataIndexElement[];
  records: KnowledgeRecord[];
  pages: PageSummary[];
  features: FeatureFlow[];
  architecture?: ArchitectureReport;
  builtAt: string;
  indexHash: string;
};

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function stem(path: string): string {
  return basename(path).replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function displayName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\(\)$/, "")
    .trim();
}

function routeLabel(route: string): string {
  if (route === "/" || !route) return "Home Page";
  const seg = route.split("/").filter(Boolean).pop() || route;
  return `${displayName(seg)} Page`;
}

function inferKind(
  path: string,
  name: string,
): KnowledgeRecord["type"] {
  if (name.startsWith("use") && name.length > 3) return "hook";
  if (/(^|\/)hooks?\//i.test(path)) return "hook";
  if (/(^|\/)services?\//i.test(path)) return "service";
  if (/(^|\/)page\.(tsx?|jsx?)$/i.test(path)) return "page";
  if (/(^|\/)route\.(tsx?|jsx?)$/i.test(path)) return "api";
  if (/(^|\/)components?\//i.test(path)) return "component";
  if (/^[A-Z]/.test(name)) return "component";
  if (/(^|\/)lib\//i.test(path) || /(^|\/)utils?\//i.test(path)) return "service";
  return "function";
}

function purposeFromName(
  kind: KnowledgeRecord["type"],
  name: string,
  path: string,
): string {
  const label = displayName(name);
  const hay = `${path} ${name}`;
  if (kind === "page") {
    if (/login|signin|sign-in/i.test(hay)) return "Allows existing users to sign in";
    if (/dashboard|home/i.test(hay)) return "Main user overview";
    if (/settings/i.test(hay)) return "User / app settings screen";
    if (/billing|checkout|payment/i.test(hay)) return "Billing and payment UI";
    return `${label} screen`;
  }
  if (kind === "hook") return `Manages ${label.replace(/^use\s*/i, "")} state`;
  if (kind === "service") {
    if (/auth/i.test(hay)) return "Authentication service";
    if (/user/i.test(hay)) return "User data service";
    if (/bill|pay|stripe/i.test(hay)) return "Billing service";
    return `${label} service`;
  }
  if (kind === "function") {
    if (/auth|login|sign/i.test(name)) return "Authenticates users with their credentials";
    if (/user/i.test(name) && /get|list|fetch/i.test(name))
      return "Retrieves users";
    return `${label} helper`;
  }
  if (kind === "api") return `HTTP API handler (${label})`;
  if (kind === "component") {
    if (/form/i.test(name)) return "Collects user credentials / input";
    if (/sidebar|nav/i.test(name)) return "Navigation / layout chrome";
    if (/card/i.test(name)) return "Displays a summary card";
    return `${label} UI component`;
  }
  return label;
}

const AUTH_SEGMENTS = new Set([
  "login",
  "signin",
  "sign-in",
  "log-in",
  "signup",
  "sign-up",
  "register",
  "session",
  "callback",
  "password",
  "auth",
  "logout",
  "log-out",
  "forgot-password",
  "reset-password",
  "magic-link",
  "oauth",
]);

const WEAK_SEGMENTS = new Set([
  "api",
  "app",
  "v1",
  "v2",
  "v3",
  "public",
  "internal",
  "index",
  "new",
  "edit",
  "page",
]);

function titleCaseWords(value: string): string {
  return displayName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function routeSegments(route: string): string[] {
  return route
    .split("/")
    .map((part) => part.trim().toLowerCase())
    .filter(
      (part) =>
        part &&
        part !== "api" &&
        !part.startsWith(":") &&
        !part.startsWith("{") &&
        !part.startsWith("(") &&
        !part.startsWith("@"),
    );
}

/** Human name for a route. `/smart-tutor` → Smart Tutor. `/` → Home. */
export function featureNameFromRoute(route: string): string {
  const segs = routeSegments(route);
  if (segs.length === 0) return "Home";
  return titleCaseWords(segs[segs.length - 1] || "page");
}

function isAuthRoute(route: string): boolean {
  return routeSegments(route).some((seg) => AUTH_SEGMENTS.has(seg));
}

function slugRoute(route: string): string {
  const slug = route
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "home";
}

function uniqueFeatureId(base: string, used: Set<string>): string {
  const root = base || "feature";
  let id = root;
  let n = 2;
  while (used.has(id)) {
    id = `${root}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function collectApiPaths(content: string): string[] {
  const out: string[] = [];
  const re = /[`'"](\/api\/[^`'"]+)[`'"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const route = match[1]!.split("?")[0]!.replace(/\/$/, "");
    if (route && !out.includes(route)) out.push(route);
  }
  return out;
}

function apiPathsMatch(mentioned: string, route: string): boolean {
  const a = mentioned.replace(/\/$/, "");
  const b = route.replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function sharesSegment(a: string, b: string): boolean {
  const left = new Set(routeSegments(a).filter((seg) => !WEAK_SEGMENTS.has(seg)));
  return routeSegments(b).some((seg) => !WEAK_SEGMENTS.has(seg) && left.has(seg));
}

function collectImports(content: string): string[] {
  const out: string[] = [];
  const re =
    /import\s+(?:type\s+)?(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const spec = m[1]!;
    if (spec.startsWith(".") || spec.startsWith("@/")) out.push(spec);
  }
  return out;
}

function collectNamedImports(content: string): string[] {
  const out: string[] = [];
  const re =
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    for (const part of m[1]!.split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
    }
  }
  const def = content.match(
    /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"]/,
  );
  if (def?.[1]) out.push(def[1]);
  return out;
}

/** Cheap call / JSX usage scan (structure stage — no LLM). */
function collectCalls(content: string): string[] {
  const out = new Set<string>();
  const jsx = content.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g);
  for (const m of jsx) out.add(m[1]!);
  const calls = content.matchAll(
    /\b([A-Za-z_$][\w$]*)\s*\(/g,
  );
  const skip = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "function",
    "return",
    "typeof",
    "new",
    "await",
    "import",
    "export",
    "const",
    "let",
    "var",
    "class",
    "interface",
    "type",
  ]);
  for (const m of calls) {
    const name = m[1]!;
    if (!skip.has(name) && name[0] === name[0]!.toLowerCase()) {
      out.add(name);
    }
  }
  return [...out].slice(0, 20);
}

function resolveImport(
  fromPath: string,
  spec: string,
  pathSet: Set<string>,
): string | null {
  if (spec.startsWith("@/")) {
    const rest = spec.slice(2);
    for (const prefix of ["", "src/"]) {
      for (const ext of [
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        "/index.tsx",
        "/index.ts",
      ]) {
        const candidate = `${prefix}${rest}${ext}`.replace(/^\//, "");
        if (pathSet.has(candidate)) return candidate;
      }
    }
    return null;
  }
  if (!spec.startsWith(".")) return null;
  const dir = fromPath.includes("/")
    ? fromPath.slice(0, fromPath.lastIndexOf("/"))
    : "";
  const joined = (dir ? `${dir}/` : "") + spec;
  const normalized = joined
    .split("/")
    .reduce<string[]>((acc, part) => {
      if (part === "." || part === "") return acc;
      if (part === "..") {
        acc.pop();
        return acc;
      }
      acc.push(part);
      return acc;
    }, [])
    .join("/");
  for (const ext of [
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    "/index.tsx",
    "/index.ts",
    "",
  ]) {
    const candidate = normalized + ext;
    if (pathSet.has(candidate)) return candidate;
  }
  return null;
}

function recordId(file: string, name: string): string {
  return `${file}:${name.replace(/\(\)$/, "")}`;
}

function elementsFromRecords(records: KnowledgeRecord[]): DataIndexElement[] {
  return records.slice(0, 80).map((r) => ({
    name: r.type === "function" || r.type === "hook" ? `${r.name.replace(/\(\)$/, "")}()` : r.name,
    kind: r.type,
    path: r.file,
    purpose: r.purpose,
    connections: [...new Set([...r.calls, ...r.used_by])].slice(0, 8),
  }));
}

/**
 * Stage 1 — structure scan (no LLM tokens).
 * Extracts symbols, imports, call/JSX edges, hashes.
 */
export function scanStructure(input: {
  fullName: string;
  ref: string;
  scope: "file" | "repo";
  focusPath: string | null;
  analysis: RepoAnalysis;
  files: RepoSourceFile[];
}): {
  records: KnowledgeRecord[];
  pages: PageSummary[];
  features: FeatureFlow[];
  indexHash: string;
} {
  const pathSet = new Set(input.files.map((f) => f.path));
  const contentByPath = new Map(input.files.map((f) => [f.path, f.content]));
  const records: KnowledgeRecord[] = [];
  const byName = new Map<string, KnowledgeRecord[]>();
  const seen = new Set<string>();

  const push = (rec: KnowledgeRecord) => {
    if (seen.has(rec.id)) return;
    seen.add(rec.id);
    records.push(rec);
    const key = rec.name.replace(/\(\)$/, "");
    const list = byName.get(key) || [];
    list.push(rec);
    byName.set(key, list);
  };

  for (const page of input.analysis.pages) {
    const content = contentByPath.get(page.path) || "";
    const imports = collectImports(content)
      .map((s) => resolveImport(page.path, s, pathSet))
      .filter(Boolean) as string[];
    const named = collectNamedImports(content);
    const calls = [
      ...named,
      ...collectCalls(content).filter((c) => /^[A-Z]/.test(c)),
    ];
    const name = page.title || routeLabel(page.route);
    push({
      id: recordId(page.path, "default"),
      type: "page",
      name,
      file: page.path,
      signature: `page ${page.route}`,
      purpose: purposeFromName("page", name, page.path),
      calls: [...new Set(calls)].slice(0, 12),
      used_by: [],
      related_pages: [page.route || "/"],
      confidence: "high",
      source_hash: hashText(content),
    });
    void imports;
  }

  for (const comp of input.analysis.components) {
    const content = contentByPath.get(comp.path) || "";
    const named = collectNamedImports(content);
    const calls = [...named, ...collectCalls(content)];
    push({
      id: recordId(comp.path, comp.name),
      type: "component",
      name: comp.name,
      file: comp.path,
      signature: `${comp.name}()`,
      purpose: purposeFromName("component", comp.name, comp.path),
      calls: [...new Set(calls)].slice(0, 12),
      used_by: [],
      related_pages: [],
      confidence: "medium",
      source_hash: hashText(content.slice(0, 8000)),
    });
  }

  for (const fn of input.analysis.functions) {
    if (fn.kind === "component") continue;
    const content = contentByPath.get(fn.path) || "";
    const kind = inferKind(fn.path, fn.name);
    const named = collectNamedImports(content);
    const calls = [...named, ...collectCalls(content)].filter(
      (c) => c !== fn.name,
    );
    push({
      id: recordId(fn.path, fn.name),
      type: kind,
      name: fn.name,
      file: fn.path,
      signature: fn.signature || `${fn.name}()`,
      purpose: purposeFromName(kind, fn.name, fn.path),
      calls: [...new Set(calls)].slice(0, 12),
      used_by: [],
      related_pages: [],
      confidence: kind === "service" || kind === "hook" ? "medium" : "low",
      source_hash: hashText(
        content.slice(Math.max(0, (fn.startLine - 1) * 40), fn.endLine * 80),
      ),
    });
  }

  // Wire used_by / related_pages from call edges
  for (const rec of records) {
    for (const callee of rec.calls) {
      const targets = byName.get(callee) || [];
      for (const t of targets) {
        if (t.id === rec.id) continue;
        if (!t.used_by.includes(rec.name)) t.used_by.push(rec.name);
        if (rec.type === "page") {
          for (const route of rec.related_pages) {
            if (!t.related_pages.includes(route)) t.related_pages.push(route);
          }
        }
      }
    }
  }

  let filtered = records;
  if (input.scope === "file" && input.focusPath) {
    const focus = input.focusPath;
    const focusStem = stem(focus);
    filtered = records.filter(
      (r) =>
        r.file === focus ||
        r.calls.includes(focusStem) ||
        r.used_by.some((u) => u === focusStem) ||
        stem(r.file) === focusStem,
    );
    if (filtered.length === 0) {
      filtered = records.filter((r) => r.file === focus);
    }
  }
  filtered = filtered.slice(0, 120);

  // Stage 3 (heuristic): page summaries + feature flows upward
  const pages: PageSummary[] = input.analysis.pages.map((page) => {
    const pageRec = filtered.find(
      (r) => r.type === "page" && r.file === page.path,
    );
    const comps = (pageRec?.calls || []).filter((c) =>
      filtered.some((r) => r.name === c && r.type === "component"),
    );
    const fns = (pageRec?.calls || []).filter((c) =>
      filtered.some(
        (r) =>
          r.name === c &&
          (r.type === "function" || r.type === "hook" || r.type === "service"),
      ),
    );
    // Expand one level: component → its calls
    for (const c of comps) {
      const crec = filtered.find((r) => r.name === c && r.type === "component");
      for (const call of crec?.calls || []) {
        if (
          filtered.some(
            (r) =>
              r.name === call &&
              (r.type === "function" ||
                r.type === "hook" ||
                r.type === "service"),
          ) &&
          !fns.includes(call)
        ) {
          fns.push(call);
        }
      }
    }
    const services = [
      ...new Set(
        fns
          .map((n) => filtered.find((r) => r.name === n))
          .filter((r) => r && (r.type === "service" || /service|auth|api/i.test(r.file)))
          .map((r) => stem(r!.file)),
      ),
    ];
    return {
      route: page.route || "/",
      purpose: pageRec?.purpose || purposeFromName("page", page.title, page.path),
      components: comps.slice(0, 12),
      functions: fns.slice(0, 12),
      related_services: services.slice(0, 8),
      summary:
        pageRec?.purpose ||
        `Handles the ${page.route || "/"} route and its UI dependencies.`,
      file: page.path,
    };
  });

  const pageList =
    input.scope === "file" && input.focusPath
      ? pages.filter(
          (page) =>
            page.file === input.focusPath ||
            filtered.some(
              (record) => record.type === "page" && record.file === page.file,
            ),
        )
      : pages;
  const features = buildFeatureFlows(
    filtered,
    pageList,
    input.analysis,
    contentByPath,
  );
  const indexHash = hashText(
    filtered.map((r) => `${r.id}:${r.source_hash}`).join("|"),
  );

  return { records: filtered, pages, features, indexHash };
}

type FeatureCluster = {
  id: string;
  name: string;
  auth: boolean;
  pages: PageSummary[];
  apis: RepoAnalysis["apiRoutes"];
  nodes: FlowNode[];
};

function serviceNode(name: string, records: KnowledgeRecord[]): FlowNode | null {
  const record =
    records.find((item) => item.name === name) ||
    records.find((item) => stem(item.file) === name);
  if (!record && !name) return null;
  const rawStem = record ? stem(record.file) : name;
  const pretty = /service/i.test(rawStem)
    ? titleCaseWords(rawStem)
    : `${titleCaseWords(rawStem)} Service`;
  return {
    id: `svc:${rawStem}:${record?.file || ""}`,
    label: pretty,
    kind: "service",
    file: record?.file,
  };
}

function nodesForPage(page: PageSummary, records: KnowledgeRecord[]): FlowNode[] {
  const nodes: FlowNode[] = [
    {
      id: `page:${page.route}:${page.file || ""}`,
      label: routeLabel(page.route),
      kind: "page",
      file: page.file,
    },
  ];
  for (const compName of page.components.slice(0, 4)) {
    const record = records.find(
      (item) => item.name === compName && item.type === "component",
    );
    nodes.push({
      id: `comp:${compName}:${record?.file || ""}`,
      label: compName,
      kind: "component",
      file: record?.file,
    });
  }
  for (const fnName of page.functions.slice(0, 4)) {
    const record = records.find((item) => item.name === fnName);
    const kind =
      record?.type === "hook"
        ? "hook"
        : record?.type === "service"
          ? "service"
          : record?.type === "api"
            ? "api"
            : "function";
    nodes.push({
      id: `fn:${fnName}:${record?.file || ""}`,
      label: fnName.includes("(") ? fnName : `${fnName}()`,
      kind,
      file: record?.file,
    });
  }
  for (const svc of page.related_services.slice(0, 2)) {
    const node = serviceNode(svc, records);
    if (node) nodes.push(node);
  }
  return nodes;
}

function apiRouteKey(route: RepoAnalysis["apiRoutes"][number]): string {
  return `${route.path}:${route.route}`;
}

function apiFlowNode(route: RepoAnalysis["apiRoutes"][number]): FlowNode {
  return {
    id: `api:${apiRouteKey(route)}`,
    label: `${featureNameFromRoute(route.route)} API`,
    kind: "api",
    file: route.path,
  };
}

function capFeatureNodes(nodes: FlowNode[]): FlowNode[] {
  const seen = new Set<string>();
  const unique: FlowNode[] = [];
  for (const node of nodes) {
    const key = `${node.kind}:${node.file || ""}:${node.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(node);
  }
  const pages = unique.filter((node) => node.kind === "page").slice(0, 4);
  const apis = unique.filter((node) => node.kind === "api").slice(0, 4);
  const rest = unique.filter((node) => node.kind !== "page" && node.kind !== "api");
  const room = Math.max(0, 12 - pages.length - apis.length);
  return [...pages, ...rest.slice(0, room), ...apis];
}

function clusterFiles(
  cluster: FeatureCluster,
  records: KnowledgeRecord[],
): string[] {
  const files = new Set<string>();
  for (const node of cluster.nodes) {
    if (node.file) files.add(node.file);
  }
  for (const page of cluster.pages) {
    if (page.file) files.add(page.file);
    for (const name of page.components) {
      const record = records.find(
        (item) => item.name === name && item.type === "component" && item.file,
      );
      if (record?.file) files.add(record.file);
    }
  }
  return [...files];
}

function mentionedApiRoutes(
  files: string[],
  contentByPath: Map<string, string>,
): string[] {
  const routes: string[] = [];
  for (const file of files) {
    for (const route of collectApiPaths(contentByPath.get(file) || "")) {
      if (!routes.includes(route)) routes.push(route);
    }
  }
  return routes;
}

function authClusterName(routes: string[]): string {
  const segs = new Set(routes.flatMap(routeSegments));
  const signsIn = [...segs].some((seg) =>
    /^(login|signin|sign-in|log-in)$/.test(seg),
  );
  const signsUp = [...segs].some((seg) =>
    /^(signup|sign-up|register)$/.test(seg),
  );
  if (signsIn && signsUp) return "Login & Signup";
  if (routes.length === 1) return featureNameFromRoute(routes[0] || "/");
  if (signsUp) return "Signup";
  if (signsIn) return "Login";
  return "Authentication";
}

function explainCluster(cluster: FeatureCluster): string {
  const routes = cluster.pages.map((page) => page.route);
  const apis = cluster.apis.map((route) => route.route);
  if (cluster.pages.length === 0) {
    return `${cluster.name} is an API with no matching screen in this scan${
      apis.length ? ` (${apis.join(", ")})` : ""
    }.`;
  }
  const summary = cluster.pages[0]?.summary?.trim();
  if (cluster.pages.length === 1) {
    const lead = summary
      ? `${cluster.name}: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`
      : `${cluster.name} is the ${routes[0]} screen.`;
    return apis.length ? `${lead} It connects to ${apis.join(", ")}.` : lead;
  }
  const joined = routes.join(", ");
  return apis.length
    ? `${cluster.name} covers ${joined} and connects to ${apis.join(", ")}.`
    : `${cluster.name} covers ${joined} as one capability.`;
}

/**
 * One card per user-reachable capability.
 * Pages stay separate unless they are the same auth flow.
 * APIs join a page when the route token or a fetch() path matches,
 * and otherwise become their own cards.
 */
function buildFeatureFlows(
  records: KnowledgeRecord[],
  pages: PageSummary[],
  analysis: RepoAnalysis,
  contentByPath: Map<string, string>,
): FeatureFlow[] {
  const usedIds = new Set<string>();
  const clusters: FeatureCluster[] = [];

  for (const page of pages) {
    const route = page.route || "/";
    clusters.push({
      id: uniqueFeatureId(slugRoute(route), usedIds),
      name: featureNameFromRoute(route),
      auth: isAuthRoute(route),
      pages: [page],
      apis: [],
      nodes: nodesForPage(page, records),
    });
  }

  const authClusters = clusters.filter((cluster) => cluster.auth);
  if (authClusters.length > 1) {
    const [primary, ...rest] = authClusters;
    if (primary) {
      for (const extra of rest) {
        primary.pages.push(...extra.pages);
        primary.nodes.push(...extra.nodes);
        const index = clusters.indexOf(extra);
        if (index >= 0) clusters.splice(index, 1);
      }
      const routes = primary.pages.map((page) => page.route || "/");
      primary.name = authClusterName(routes);
      usedIds.delete(primary.id);
      primary.id = uniqueFeatureId(
        primary.name === "Login & Signup"
          ? "login-and-signup"
          : slugRoute(routes[0] || "/auth"),
        usedIds,
      );
    }
  }

  const claimed = new Set<string>();
  for (const route of analysis.apiRoutes) {
    const host = clusters.find((cluster) => {
      if (
        cluster.auth &&
        isAuthRoute(route.route) &&
        cluster.pages.length > 0
      ) {
        return true;
      }
      if (cluster.pages.some((page) => sharesSegment(page.route, route.route))) {
        return true;
      }
      const mentioned = mentionedApiRoutes(
        clusterFiles(cluster, records),
        contentByPath,
      );
      return mentioned.some((path) => apiPathsMatch(path, route.route));
    });
    if (!host) continue;
    host.apis.push(route);
    host.nodes.push(apiFlowNode(route));
    claimed.add(apiRouteKey(route));
  }

  const looseAuth: RepoAnalysis["apiRoutes"] = [];
  for (const route of analysis.apiRoutes) {
    if (claimed.has(apiRouteKey(route))) continue;
    if (isAuthRoute(route.route)) {
      looseAuth.push(route);
      continue;
    }
    const name = `${featureNameFromRoute(route.route)} API`;
    clusters.push({
      id: uniqueFeatureId(slugRoute(route.route), usedIds),
      name,
      auth: false,
      pages: [],
      apis: [route],
      nodes: [apiFlowNode(route)],
    });
  }
  if (looseAuth.length > 0) {
    const name =
      looseAuth.length > 1
        ? authClusterName(looseAuth.map((route) => route.route))
        : `${featureNameFromRoute(looseAuth[0]!.route)} API`;
    clusters.push({
      id: uniqueFeatureId("auth-api", usedIds),
      name: looseAuth.length > 1 && name === "Home" ? "Authentication" : name,
      auth: true,
      pages: [],
      apis: looseAuth,
      nodes: looseAuth.map(apiFlowNode),
    });
  }

  const features: FeatureFlow[] = [];
  for (const cluster of clusters) {
    const nodes = capFeatureNodes(cluster.nodes);
    if (nodes.length === 0) continue;
    features.push({
      id: cluster.id,
      name: cluster.name,
      title: cluster.name,
      nodes,
      explanation: explainCluster(cluster),
    });
  }

  features.sort((a, b) => a.name.localeCompare(b.name));
  return features.slice(0, 80);
}

/** Keep the scanned feature list. AI may rewrite copy for ids it recognizes. */
function overlayFeatureCopy(
  base: FeatureFlow[],
  polished: FeatureFlow[] | undefined,
): FeatureFlow[] {
  if (!polished?.length) return base;
  const byId = new Map(polished.map((feature) => [feature.id, feature]));
  return base.map((feature) => {
    const next = byId.get(feature.id);
    if (!next) return feature;
    return {
      ...feature,
      name: next.name.trim() || feature.name,
      title: next.title.trim() || feature.title,
      explanation: next.explanation.trim() || feature.explanation,
    };
  });
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced?.[1]?.trim() || trimmed;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  return JSON.parse(text);
}

/**
 * Stages 2–3 — intent summaries + upward feature polish via LLM
 * (only when configured; otherwise heuristic stands).
 */
export async function enrichIndexWithAi(
  index: DataIndex,
  snippets: Array<{ path: string; excerpt: string }>,
): Promise<DataIndex> {
  if (index.records.length === 0 && index.elements.length === 0) return index;
  try {
    const cfg = getLlmConfig();
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });
    const completion = await client.chat.completions.create({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 2200,
      messages: [
        {
          role: "system",
          content: `You enrich a compact repository knowledge index for Bug Analyzer / Repository Explorer.
Return ONLY JSON with this shape:
{
  "records":[{"id","type","name","file","signature","purpose","calls","used_by","related_pages","confidence","source_hash"}],
  "pages":[{"route","purpose","components","functions","related_services","summary","file"}],
  "features":[{"id","name","title","nodes":[{"id","label","kind","file"}],"explanation"}]
}
Rules:
- Prefer the seed records; do not invent files that are not listed.
- purpose/summary/explanation: short, concrete intent (like the mock: Login Page → LoginForm → loginUser() → Authentication Service).
- features: keep every seed feature id. Rewrite only name, title, and explanation. Do not merge, drop, or invent features, and do not invent files. Copy each feature's nodes from the seed.
- Keep confidence high|medium|low. Preserve source_hash from seed when possible.
- Max 60 records, 40 pages, 80 features.`,
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              repo: index.fullName,
              scope: index.scope,
              focusPath: index.focusPath,
              seed: {
                records: index.records.slice(0, 40),
                pages: index.pages.slice(0, 16),
                features: index.features.slice(0, 40),
              },
              snippets: snippets.slice(0, 20),
            },
            null,
            2,
          ),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = dataIndexSchema.parse(extractJson(raw));
    const records = (parsed.records?.length
      ? parsed.records
      : index.records) as KnowledgeRecord[];
    const pages = (parsed.pages?.length ? parsed.pages : index.pages) as PageSummary[];
    const features = overlayFeatureCopy(index.features, parsed.features);
    const elements =
      parsed.elements && parsed.elements.length > 0
        ? parsed.elements
        : elementsFromRecords(records);
    return {
      ...index,
      source: "ai",
      status: "indexed",
      records,
      pages,
      features,
      elements,
      builtAt: new Date().toISOString(),
    };
  } catch {
    return index;
  }
}

export function buildAnalysisAndIndex(input: {
  fullName: string;
  ref: string;
  scope: "file" | "repo";
  focusPath: string | null;
  files: RepoSourceFile[];
  truncated: boolean;
}): { analysis: RepoAnalysis; index: DataIndex; files: RepoSourceFile[] } {
  let files = input.files;
  if (input.scope === "file" && input.focusPath) {
    const dir = input.focusPath.includes("/")
      ? input.focusPath.slice(0, input.focusPath.lastIndexOf("/"))
      : "";
    const neighbors = files.filter(
      (f) =>
        f.path === input.focusPath ||
        (dir && f.path.startsWith(dir + "/")) ||
        /(^|\/)(services|hooks|lib|components)\//i.test(f.path),
    );
    files = neighbors.slice(0, 80);
  }

  const analysis = analyzeNextRepo({
    fullName: input.fullName,
    ref: input.ref,
    files,
    truncated: input.truncated,
  });
  const scanned = scanStructure({
    fullName: input.fullName,
    ref: input.ref,
    scope: input.scope,
    focusPath: input.focusPath,
    analysis,
    files,
  });

  const appName =
    input.fullName.split("/")[1] || input.fullName || "repository";

  const elements = elementsFromRecords(scanned.records);
  const inventoryPartial =
    input.truncated ||
    (scanned.records.length === 0 && scanned.features.length === 0);
  const index: DataIndex = {
    fullName: input.fullName,
    ref: input.ref,
    scope: input.scope,
    focusPath: input.focusPath,
    source: "heuristic",
    status: inventoryPartial ? "partial" : "indexed",
    appName,
    elements:
      elements.length > 0
        ? elements
        : [
            {
              name: appName,
              kind: "other",
              path: input.focusPath || ".",
              purpose:
                "No code elements detected yet — try Entire repo or another file.",
              connections: [],
            },
          ],
    records: scanned.records,
    pages: scanned.pages,
    features: scanned.features,
    builtAt: new Date().toISOString(),
    indexHash: scanned.indexHash,
  };
  return { analysis, index, files };
}

function snippetsForIndex(
  index: DataIndex,
  files: RepoSourceFile[],
): Array<{ path: string; excerpt: string }> {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const paths = [
    ...new Set([
      ...index.records.map((r) => r.file),
      ...index.elements.map((e) => e.path),
    ]),
  ].slice(0, 24);
  return paths.map((path) => ({
    path,
    excerpt: (byPath.get(path) || "").slice(0, 1200),
  }));
}

/** Full pipeline: structure → intent → feature flows → logical-gap architecture. */
export async function buildDataIndex(input: {
  fullName: string;
  ref: string;
  scope: "file" | "repo";
  focusPath: string | null;
  files: RepoSourceFile[];
  truncated: boolean;
}): Promise<DataIndex> {
  const { index, files, analysis } = buildAnalysisAndIndex(input);
  if (index.records.length === 0 && analysis.pages.length === 0) {
    return index;
  }
  const enriched = await enrichIndexWithAi(index, snippetsForIndex(index, files));
  return attachArchitectureAnalysis(enriched, analysis, files);
}

/** @deprecated use enrichIndexWithAi — kept for callers that still pass flat elements */
export async function enrichDataIndexWithAi(
  index: DataIndex,
  snippets: Array<{ path: string; excerpt: string }>,
): Promise<DataIndex> {
  return enrichIndexWithAi(index, snippets);
}

/** @deprecated use scanStructure */
export function heuristicDataIndex(input: {
  fullName: string;
  ref: string;
  scope: "file" | "repo";
  focusPath: string | null;
  analysis: RepoAnalysis;
  files: RepoSourceFile[];
}): DataIndex {
  const scanned = scanStructure(input);
  const appName =
    input.fullName.split("/")[1] || input.fullName || "repository";
  return {
    fullName: input.fullName,
    ref: input.ref,
    scope: input.scope,
    focusPath: input.focusPath,
    source: "heuristic",
    status: scanned.records.length > 0 ? "indexed" : "partial",
    appName,
    elements: elementsFromRecords(scanned.records),
    records: scanned.records,
    pages: scanned.pages,
    features: scanned.features,
    builtAt: new Date().toISOString(),
    indexHash: scanned.indexHash,
  };
}
