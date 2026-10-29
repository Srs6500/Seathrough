import type { FlowEdge, FlowNode } from "@/lib/data-flow/types";
import type {
  FrontendArchFinding,
  FrontendArchScanResult,
} from "@/lib/frontend-arch/types";

export type NodeHealth = "healthy" | "error" | "warning";

export type ArchViewNode = FlowNode & {
  health: NodeHealth;
  issueLabel?: string;
  shortPath: string;
};

function shortPath(path: string): string {
  return path
    .replace(/^src\//, "")
    .replace(/\/page\.(tsx|jsx|ts|js)$/, "")
    .replace(/\.(tsx|jsx|ts|js|py|go)$/, "");
}

export function healthByNodeId(
  findings: FrontendArchFinding[],
): Map<string, { health: NodeHealth; issueLabel: string }> {
  const map = new Map<string, { health: NodeHealth; issueLabel: string }>();
  for (const f of findings) {
    if (!f.nodeId) continue;
    const prev = map.get(f.nodeId);
    const nextHealth: NodeHealth =
      f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "healthy";
    if (!prev) {
      map.set(f.nodeId, { health: nextHealth, issueLabel: f.title });
      continue;
    }
    const rank = { healthy: 0, warning: 1, error: 2 } as const;
    if (rank[nextHealth] > rank[prev.health]) {
      map.set(f.nodeId, { health: nextHealth, issueLabel: f.title });
    }
  }
  return map;
}

/** Pages inherit the worst health from components they import (1–2 hops). */
export function healthByNodeIdWithPageRollup(
  scan: FrontendArchScanResult,
): Map<string, { health: NodeHealth; issueLabel: string }> {
  const map = healthByNodeId(scan.findings);
  const rank = { healthy: 0, warning: 1, error: 2 } as const;

  const childrenOf = new Map<string, string[]>();
  for (const e of scan.edges) {
    if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
    childrenOf.get(e.from)!.push(e.to);
  }

  for (const page of scan.nodes.filter((n) => n.kind === "page")) {
    const stack = [...(childrenOf.get(page.id) || [])];
    const seen = new Set<string>();
    let worst = map.get(page.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const h = map.get(id);
      if (h && (!worst || rank[h.health] > rank[worst.health])) {
        worst = h;
      }
      for (const c of childrenOf.get(id) || []) {
        if (!seen.has(c)) stack.push(c);
      }
      if (seen.size > 24) break;
    }
    if (worst) map.set(page.id, worst);
  }
  return map;
}

export function enrichNodes(
  nodes: FlowNode[],
  findings: FrontendArchFinding[],
  scan?: FrontendArchScanResult,
): ArchViewNode[] {
  const health = scan
    ? healthByNodeIdWithPageRollup(scan)
    : healthByNodeId(findings);
  return nodes.map((n) => {
    const h = health.get(n.id);
    return {
      ...n,
      health: h?.health ?? "healthy",
      issueLabel: h?.issueLabel,
      shortPath: shortPath(n.span.path),
    };
  });
}

/** Best page that owns / imports the finding’s node (for “where is this?”). */
export function relatedPageForFinding(
  scan: FrontendArchScanResult,
  finding: FrontendArchFinding,
): FlowNode | null {
  const pages = scan.nodes.filter((n) => n.kind === "page");
  if (finding.nodeId) {
    const self = pages.find((p) => p.id === finding.nodeId);
    if (self) return self;
    const direct = pages.find((p) =>
      scan.edges.some((e) => e.from === p.id && e.to === finding.nodeId),
    );
    if (direct) return direct;
  }
  // Same path prefix / folder heuristic
  const path = finding.path.replace(/^src\//, "");
  const byPath = pages.find(
    (p) =>
      finding.path === p.span.path ||
      path.startsWith(p.span.path.replace(/^src\//, "").replace(/\/page\.\w+$/, "")),
  );
  return byPath ?? null;
}

export function shortFilePath(path: string): string {
  return path.replace(/^src\//, "");
}

/** Level 1 — pages only, navigation edges between pages. */
export function buildOverviewGraph(scan: FrontendArchScanResult): {
  nodes: ArchViewNode[];
  edges: FlowEdge[];
} {
  const pages = scan.nodes.filter((n) => n.kind === "page");
  const pageIds = new Set(pages.map((p) => p.id));
  const navEdges = scan.edges.filter(
    (e) =>
      pageIds.has(e.from) &&
      pageIds.has(e.to) &&
      /link/i.test(e.label || e.reason),
  );
  // Prefer pages with issues, then alphabetical — cap for readability
  const enriched = enrichNodes(pages, scan.findings, scan);
  enriched.sort((a, b) => {
    const rank = { error: 0, warning: 1, healthy: 2 };
    const d = rank[a.health] - rank[b.health];
    if (d !== 0) return d;
    return a.title.localeCompare(b.title);
  });
  const capped = enriched.slice(0, 14);
  const keep = new Set(capped.map((n) => n.id));
  return {
    nodes: capped,
    edges: navEdges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

/**
 * Level 2 — focused flow for one page: page → imported components → APIs.
 * Depth-limited so the diagram stays readable.
 */
export function buildPageFlowGraph(
  scan: FrontendArchScanResult,
  pageId: string,
): { nodes: ArchViewNode[]; edges: FlowEdge[] } {
  const byId = new Map(scan.nodes.map((n) => [n.id, n]));
  const page = byId.get(pageId);
  if (!page) return { nodes: [], edges: [] };

  const outgoing = (id: string) =>
    scan.edges.filter((e) => e.from === id && byId.has(e.to));

  const keep = new Set<string>([pageId]);
  const layer1 = outgoing(pageId)
    .map((e) => e.to)
    .filter((id) => {
      const n = byId.get(id);
      return n && (n.kind === "component" || n.kind === "api" || n.kind === "lib");
    })
    .slice(0, 8);
  for (const id of layer1) keep.add(id);

  for (const id of [...layer1]) {
    for (const e of outgoing(id).slice(0, 4)) {
      const n = byId.get(e.to);
      if (!n || n.kind === "database") continue;
      if (keep.size >= 14) break;
      keep.add(e.to);
    }
  }

  // Include nodes that have findings on this page's files even if not linked
  for (const f of scan.findings) {
    if (!f.nodeId || keep.has(f.nodeId)) continue;
    if (f.path === page.span.path || layer1.some((id) => byId.get(id)?.span.path === f.path)) {
      keep.add(f.nodeId);
    }
  }

  const nodes = enrichNodes(
    [...keep].map((id) => byId.get(id)!).filter(Boolean),
    scan.findings,
    scan,
  );
  const edges = scan.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { nodes, edges };
}

export function countHealthy(scan: FrontendArchScanResult): number {
  const health = healthByNodeId(scan.findings);
  let healthy = 0;
  for (const n of scan.nodes) {
    if ((health.get(n.id)?.health ?? "healthy") === "healthy") healthy += 1;
  }
  return healthy;
}
