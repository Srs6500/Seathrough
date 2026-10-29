import { indexRepo, primaryFramework } from "@/lib/data-flow/indexRepo";
import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import type { FlowEdge, FlowNode } from "@/lib/data-flow/types";
import { findStaticFrontendProblems } from "@/lib/frontend-arch/staticProblems";
import {
  FRONTEND_ARCH_CHECKS,
  type FrontendArchScanResult,
} from "@/lib/frontend-arch/types";

const MAX_CHILDREN_PER_PAGE = 10;
const MAX_TOTAL_NODES = 80;

/**
 * Build a frontend architecture graph + static findings from repo source files.
 * Uses the TypeScript/Next path indexer (not an LLM) for connections.
 */
export function buildFrontendArchitecture(input: {
  files: RepoSourceFile[];
  fullName: string;
  ref: string;
  truncated: boolean;
}): FrontendArchScanResult {
  const { files, fullName, ref, truncated } = input;
  const index = indexRepo(files);

  const checks = FRONTEND_ARCH_CHECKS.map((c) => ({
    id: c.id,
    label: c.label,
    detail: c.detail,
    status: truncated ? ("limited" as const) : ("ran" as const),
  }));

  if (!index.frameworkOk) {
    return {
      fullName,
      ref,
      framework: primaryFramework(index),
      fileCount: files.length,
      truncated,
      incomplete: true,
      warnings: index.warnings,
      nodes: [],
      edges: [],
      findings: [],
      checks,
      stats: {
        pages: 0,
        components: 0,
        apis: 0,
        connections: 0,
        errors: 0,
        warnings: 0,
      },
      scannedAt: new Date().toISOString(),
    };
  }

  const symbolById = new Map(index.symbols.map((s) => [s.id, s]));
  const pages = index.symbols.filter((s) => s.kind === "page");
  const apis = index.symbols.filter((s) => s.kind === "api");

  // Outgoing adjacency (directed) — for page → child expansion
  const out = new Map<string, string[]>();
  for (const e of index.edges) {
    if (!out.has(e.fromId)) out.set(e.fromId, []);
    out.get(e.fromId)!.push(e.toId);
  }

  const keep = new Set<string>();
  for (const page of pages) {
    keep.add(page.id);
  }
  if (pages.length === 0) {
    for (const api of apis.slice(0, 40)) keep.add(api.id);
    for (const s of index.symbols) {
      if (keep.size >= MAX_TOTAL_NODES) break;
      if (s.kind === "component") keep.add(s.id);
    }
  }

  // Fair share: each page gets its own neighborhood so large repos stay navigable
  for (const page of pages) {
    const children = (out.get(page.id) || [])
      .map((id) => symbolById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .filter((s) => s.kind !== "database")
      .slice(0, MAX_CHILDREN_PER_PAGE);
    for (const child of children) {
      if (keep.size >= MAX_TOTAL_NODES) break;
      keep.add(child.id);
      // one more hop for form → api style chains
      for (const grandId of (out.get(child.id) || []).slice(0, 3)) {
        if (keep.size >= MAX_TOTAL_NODES) break;
        const grand = symbolById.get(grandId);
        if (!grand || grand.kind === "database") continue;
        keep.add(grand.id);
      }
    }
  }

  // Problem-prone form components even if not linked from a page yet
  for (const s of index.symbols) {
    if (keep.size >= MAX_TOTAL_NODES) break;
    if (keep.has(s.id)) continue;
    if (s.kind === "component" && /form|login|signup|auth/i.test(s.path + s.title)) {
      keep.add(s.id);
    }
  }

  const nodes: FlowNode[] = [...keep]
    .map((id) => symbolById.get(id))
    .filter(Boolean)
    .map((s) => ({
      id: s!.id,
      kind: s!.kind,
      title: s!.title,
      summary: s!.route ? `${s!.path} · ${s!.route}` : s!.path,
      span: {
        path: s!.path,
        startLine: s!.startLine,
        endLine: s!.endLine,
        snippet: s!.snippet,
      },
      certainty: "confirmed" as const,
    }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = index.edges
    .filter((e) => nodeIds.has(e.fromId) && nodeIds.has(e.toId))
    .map((e, i) => ({
      id: `e-${i}-${e.fromId}-${e.toId}`,
      from: e.fromId,
      to: e.toId,
      label: e.label,
      certainty: e.certainty,
      reason: e.reason,
    }));

  const pathToNodeId = new Map<string, string>();
  for (const n of nodes) {
    pathToNodeId.set(n.span.path, n.id);
  }

  let findings = findStaticFrontendProblems({
    files,
    index,
    pathToNodeId,
  });

  for (const f of findings) {
    if (!f.nodeId) f.nodeId = pathToNodeId.get(f.path);
  }

  // Truncated trees: keep import findings but mark suspected (target may be unscanned)
  if (truncated) {
    findings = findings.map((f) =>
      f.category === "component_connections" &&
      /Cannot resolve module/.test(f.summary)
        ? {
            ...f,
            verification: "suspected" as const,
            severity: "warning" as const,
            summary: `${f.summary} (scan was truncated — file may exist outside the downloaded set)`,
          }
        : f,
    );
  }

  return {
    fullName,
    ref,
    framework: primaryFramework(index),
    fileCount: files.length,
    truncated,
    incomplete: truncated,
    warnings: [
      ...index.warnings,
      truncated
        ? "Repository file list was truncated; some connections may be missing."
        : "",
      findings.length === 0
        ? truncated
          ? "0 issues does not mean the app is clean — coverage was limited."
          : "No matches for current static heuristics (not a full QA pass)."
        : "",
    ].filter(Boolean),
    nodes,
    edges,
    findings,
    checks,
    stats: {
      pages: nodes.filter((n) => n.kind === "page").length,
      components: nodes.filter((n) => n.kind === "component").length,
      apis: nodes.filter((n) => n.kind === "api").length,
      connections: edges.length,
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
    },
    scannedAt: new Date().toISOString(),
  };
}
