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
  features: z.array(featureFlowSchema).max(24).optional(),
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

function featureBucket(text: string): string {
  const t = text.toLowerCase();
  if (/auth|login|signin|sign-in|signup|register|session|password/i.test(t))
    return "Authentication";
  if (/bill|payment|checkout|stripe|invoice|subscription|pricing/i.test(t))
    return "Billing";
  if (/dashboard|home|overview|analytics/i.test(t)) return "Dashboard";
  if (/settings|profile|account/i.test(t)) return "Settings";
  if (/user|member|team/i.test(t)) return "Users";
  return "Application";
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

  const features = buildFeatureFlows(filtered, pages, input.analysis);
  const indexHash = hashText(
    filtered.map((r) => `${r.id}:${r.source_hash}`).join("|"),
  );

  return { records: filtered, pages, features, indexHash };
}

function buildFeatureFlows(
  records: KnowledgeRecord[],
  pages: PageSummary[],
  analysis: RepoAnalysis,
): FeatureFlow[] {
  const buckets = new Map<string, PageSummary[]>();
  for (const page of pages) {
    const bucket = featureBucket(
      `${page.route} ${page.purpose} ${page.components.join(" ")}`,
    );
    const list = buckets.get(bucket) || [];
    list.push(page);
    buckets.set(bucket, list);
  }

  // If few pages, also bucket by services/components
  if (buckets.size === 0 || (pages.length === 0 && records.length > 0)) {
    for (const rec of records) {
      const bucket = featureBucket(`${rec.name} ${rec.file} ${rec.purpose}`);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
    }
  }

  const features: FeatureFlow[] = [];
  for (const [name, pageList] of buckets) {
    const page = pageList[0];
    const nodes: FlowNode[] = [];

    if (page) {
      nodes.push({
        id: `page:${page.route}`,
        label: routeLabel(page.route),
        kind: "page",
        file: page.file,
      });
      const compName = page.components[0];
      if (compName) {
        const crec = records.find((r) => r.name === compName);
        nodes.push({
          id: `comp:${compName}`,
          label: compName,
          kind: "component",
          file: crec?.file,
        });
      }
      const fnName =
        page.functions.find((f) =>
          records.some((r) => r.name === f && r.type === "function"),
        ) || page.functions[0];
      if (fnName) {
        const frec = records.find((r) => r.name === fnName);
        nodes.push({
          id: `fn:${fnName}`,
          label: fnName.includes("(") ? fnName : `${fnName}()`,
          kind: frec?.type === "hook" ? "hook" : "function",
          file: frec?.file,
        });
      }
      const svc =
        page.related_services[0] ||
        records.find(
          (r) =>
            r.type === "service" &&
            (page.functions.includes(r.name) ||
              page.components.some((c) => r.used_by.includes(c))),
        )?.name;
      if (svc) {
        const srec =
          records.find((r) => r.name === svc) ||
          records.find((r) => stem(r.file) === svc);
        const rawStem = srec ? stem(srec.file) : String(svc);
        const pretty =
          /auth/i.test(rawStem)
            ? "Authentication Service"
            : /user/i.test(rawStem)
              ? "Users Service"
              : /bill|pay|stripe/i.test(rawStem)
                ? "Billing Service"
                : /service/i.test(rawStem)
                  ? displayName(rawStem)
                  : `${displayName(rawStem)} Service`;
        nodes.push({
          id: `svc:${svc}`,
          label: pretty,
          kind: "service",
          file: srec?.file,
        });
      }
    } else {
      // Feature with no page — pick top records in bucket
      const inBucket = records.filter(
        (r) => featureBucket(`${r.name} ${r.file}`) === name,
      );
      for (const kind of [
        "page",
        "component",
        "function",
        "service",
      ] as const) {
        const hit = inBucket.find((r) => r.type === kind);
        if (hit) {
          nodes.push({
            id: hit.id,
            label:
              hit.type === "function" || hit.type === "hook"
                ? `${hit.name.replace(/\(\)$/, "")}()`
                : hit.type === "service"
                  ? `${displayName(stem(hit.file))} Service`
                  : hit.name,
            kind: hit.type,
            file: hit.file,
          });
        }
      }
    }

    if (nodes.length === 0) continue;

    const explanation = page
      ? `This flow ${page.summary.charAt(0).toLowerCase()}${page.summary.slice(1)}`
      : `${name} connects ${nodes.map((n) => n.label).join(" → ")}.`;

    features.push({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      title: `${name} flow`,
      nodes: nodes.slice(0, 8),
      explanation,
    });
  }

  // Prefer Authentication / Dashboard / Billing order when present
  const order = [
    "Authentication",
    "Dashboard",
    "Billing",
    "Settings",
    "Users",
    "Application",
  ];
  features.sort(
    (a, b) =>
      (order.indexOf(a.name) === -1 ? 99 : order.indexOf(a.name)) -
      (order.indexOf(b.name) === -1 ? 99 : order.indexOf(b.name)),
  );

  if (features.length === 0 && analysis.pages[0]) {
    const p = analysis.pages[0];
    features.push({
      id: "application",
      name: "Application",
      title: "Application flow",
      nodes: [
        {
          id: "page",
          label: routeLabel(p.route),
          kind: "page",
          file: p.path,
        },
      ],
      explanation: "Indexed page structure for this repository.",
    });
  }

  return features.slice(0, 12);
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
- features: application capabilities (Authentication, Dashboard, Billing, …) each with a vertical flow of 3–5 nodes.
- Keep confidence high|medium|low. Preserve source_hash from seed when possible.
- Max 60 records, 20 pages, 10 features.`,
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
                features: index.features.slice(0, 8),
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
    const features = (parsed.features?.length
      ? parsed.features
      : index.features) as FeatureFlow[];
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
  const index: DataIndex = {
    fullName: input.fullName,
    ref: input.ref,
    scope: input.scope,
    focusPath: input.focusPath,
    source: "heuristic",
    status: scanned.records.length > 0 ? "indexed" : "partial",
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
