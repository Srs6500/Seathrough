import type {
  ArchitectureReport,
  LogicalFinding,
} from "@/lib/bug-analyzer/analyzeLogicalGaps";
import {
  featureNameFromRoute,
  type DataIndex,
  type FeatureFlow,
  type FlowNode,
  type KnowledgeRecord,
} from "@/lib/bug-analyzer/buildDataIndex";
import type {
  FrontendArchFinding,
  FrontendArchScanResult,
} from "@/lib/frontend-arch/types";
import type {
  XRayEvidence,
  XRayFeature,
  XRayFeatureKind,
  XRayFeatureStatus,
  XRayFinding,
  XRayNode,
  XRayReport,
} from "@/lib/xray/types";

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

export function classifyFeatureKind(text: string): XRayFeatureKind {
  const t = text.toLowerCase();
  if (/auth|login|signin|sign-in|signup|sign-up|register|session|password|credential/.test(t)) {
    return "auth";
  }
  if (/bill|payment|checkout|stripe|invoice|subscription|pricing|order/.test(t)) {
    return "payments";
  }
  if (/dashboard|home|overview|analytics/.test(t)) return "dashboard";
  if (/settings|profile|account/.test(t)) return "settings";
  if (/user|member|team/.test(t)) return "users";
  return "other";
}

export function friendlyFeatureName(kind: XRayFeatureKind, fallback: string): string {
  switch (kind) {
    case "auth":
      return "Login & Signup";
    case "dashboard":
      return "Dashboard";
    case "payments":
      return "Payments";
    case "settings":
      return "User Settings";
    case "users":
      return "Users";
    default:
      return fallback.replace(/\s+flow$/i, "").trim() || "Application";
  }
}

function kindRole(kind: string): string {
  switch (kind) {
    case "page":
      return "Screen the user sees";
    case "component":
      return "UI piece on that screen";
    case "function":
    case "hook":
      return "Code that runs when the user acts";
    case "service":
      return "App logic behind the screen";
    case "api":
      return "Server endpoint";
    default:
      return "Related code";
  }
}

function nodeHay(node: { label: string; file?: string; kind: string }): string {
  return `${node.label} ${node.file || ""} ${node.kind}`;
}

function featureHay(feature: {
  name: string;
  title?: string;
  nodes: Array<{ label: string; file?: string; kind: string }>;
}): string {
  return `${feature.name} ${feature.title || ""} ${feature.nodes.map(nodeHay).join(" ")}`;
}

function severityRank(severity: XRayFinding["severity"]): number {
  switch (severity) {
    case "critical":
    case "error":
      return 0;
    case "high":
      return 1;
    case "medium":
    case "warning":
      return 2;
    default:
      return 3;
  }
}

function fromArchitectureFinding(f: LogicalFinding): XRayFinding {
  return {
    id: f.id,
    title: f.title,
    summary: f.summary,
    severity: f.severity,
    status: f.status,
    category: f.category,
    source: "architecture",
    inferredIntent: f.inferredIntent,
    contradiction: f.contradiction,
    fixSuggestion: f.fixSuggestion,
    evidence: f.evidence.map((e) => ({
      file: e.file,
      startLine: e.startLine,
      endLine: e.endLine,
      snippet: e.snippet,
      note: e.note,
    })),
  };
}

function fromFrontendFinding(f: FrontendArchFinding): XRayFinding {
  return {
    id: f.id,
    title: f.title,
    summary: f.summary,
    severity: f.severity,
    status: f.verification === "confirmed" ? "confirmed" : "suspected",
    category: f.category,
    source: "frontend",
    fixSuggestion: f.suggestedFix,
    evidence: [
      {
        file: f.path,
        startLine: f.startLine,
        endLine: f.endLine,
        snippet: f.snippet,
      },
    ],
  };
}

function scoreFinding(
  finding: XRayFinding,
  feature: { kind: XRayFeatureKind; name: string; nodes: XRayNode[] },
  extra?: { nodeIds?: string[]; flow?: string[] },
): number {
  let score = 0;
  const hay = featureHay(feature).toLowerCase();
  const files = new Set(
    feature.nodes.map((n) => n.file).filter((p): p is string => Boolean(p)),
  );

  for (const ev of finding.evidence) {
    if (!ev.file) continue;
    if (files.has(ev.file)) score += 8;
    for (const file of files) {
      if (ev.file.endsWith(file) || file.endsWith(ev.file)) score += 6;
      if (basename(ev.file) === basename(file)) score += 4;
    }
  }

  if (extra?.flow?.some((step) => hay.includes(step.toLowerCase()))) score += 5;
  if (
    extra?.nodeIds?.some((id) =>
      feature.nodes.some((n) => n.id === id || n.file === id),
    )
  ) {
    score += 6;
  }

  const blob = `${finding.title} ${finding.summary} ${finding.category}`.toLowerCase();
  const kindOfFinding = classifyFeatureKind(`${blob} ${finding.evidence.map((e) => e.file).join(" ")}`);
  if (kindOfFinding === feature.kind && feature.kind !== "other") score += 4;

  if (feature.kind === "auth" && /login|signin|signup|sign-up|register|credential|password/.test(blob)) {
    score += 3;
  }
  if (feature.kind === "dashboard" && /dashboard/.test(blob)) score += 3;
  if (feature.kind === "payments" && /bill|pay|checkout|stripe|order|invoice/.test(blob)) {
    score += 3;
  }
  if (feature.kind === "settings" && /settings|profile|account/.test(blob)) score += 3;

  const catN = norm(finding.category);
  const nameN = norm(feature.name);
  if (catN && nameN && (catN === nameN || catN.includes(nameN) || nameN.includes(catN))) {
    score += 2;
  }

  return score;
}

function statusFor(feature: {
  findings: XRayFinding[];
  nodes: XRayNode[];
  relevantCode: XRayEvidence[];
}): XRayFeatureStatus {
  const serious = feature.findings.filter(
    (f) =>
      severityRank(f.severity) <= 2 &&
      (f.status === "confirmed" ||
        f.status === "likely" ||
        f.status === "suspected"),
  );
  if (serious.length > 0) return "needs_review";

  const files = feature.relevantCode.filter((c) => c.file && c.file !== ".");
  const connected = feature.nodes.length >= 2 && files.length >= 1;
  if (connected) return "connections_found";
  return "not_verified";
}

function headlineFor(featureName: string, findings: XRayFinding[]): string {
  const top = [...findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  )[0];
  if (!top) {
    return `${featureName} is present in the scanned source, with the screens and handlers listed below.`;
  }
  if (top.source === "architecture" && top.contradiction) {
    return top.summary;
  }
  return top.summary || top.title;
}

function beginnerExplanation(input: {
  name: string;
  kind: XRayFeatureKind;
  nodes: XRayNode[];
  findings: XRayFinding[];
  seed?: string;
}): string {
  const flow = input.nodes.map((n) => n.label).join(" → ");
  const purpose =
    input.kind === "auth"
      ? "people sign in or create an account"
      : input.kind === "dashboard"
        ? "signed-in users land after they arrive"
        : input.kind === "payments"
          ? "someone pays or is billed"
          : input.kind === "settings"
            ? "someone changes account or app preferences"
            : input.kind === "users"
              ? "the app lists or edits people"
              : "this part of the product runs";

  const top = input.findings[0];
  const seed = input.seed?.trim();
  const seedOk =
    seed &&
    seed.length > 24 &&
    !/^this flow /i.test(seed) &&
    !/indexed page structure/i.test(seed);

  if (top) {
    const evidence = top.evidence[0];
    const loc = evidence?.file
      ? evidence.startLine
        ? `${evidence.file}:${evidence.startLine}`
        : evidence.file
      : null;
    const gap = top.contradiction || top.summary;
    return [
      `${input.name} is the part of the app where ${purpose}.`,
      flow ? `In the code it currently goes ${flow}.` : "",
      gap,
      loc ? `The scan points at ${loc} as evidence.` : "",
      "This is a reading of the source — confirm it with a test before treating it as a shipped bug.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (seedOk) {
    return `${seed} In the scanned files this looks like ${flow || input.name}.`;
  }

  return [
    `${input.name} is the part of the app where ${purpose}.`,
    flow
      ? `The scanned files connect ${flow}.`
      : "The scan found this area but could not map a full path yet.",
    "Nothing in this pass looked disconnected, but the map is from static reading of the repo — not a live run.",
  ].join(" ");
}

function verifyNextFor(kind: XRayFeatureKind, findings: XRayFinding[]): string[] {
  const fromFindings = findings
    .flatMap((f) => {
      const items: string[] = [];
      if (f.contradiction) {
        items.push(`Confirm this in the running app: ${stripPeriod(f.contradiction)}`);
      }
      if (f.fixSuggestion) {
        items.push(stripPeriod(f.fixSuggestion));
      }
      return items;
    })
    .filter((s, i, arr) => arr.findIndex((x) => x === s) === i)
    .slice(0, 2);

  const defaults: Record<XRayFeatureKind, string[]> = {
    auth: [
      "Verify server-side session validation",
      "Test incorrect credentials",
      "Check protected routes",
    ],
    dashboard: [
      "Open the dashboard while signed out",
      "Check that each widget loads from a real API",
      "Confirm empty and error states",
    ],
    payments: [
      "Confirm charges are created on the server, not only in the UI",
      "Test a failed or cancelled payment",
      "Check webhook or confirmation handling",
    ],
    settings: [
      "Save a setting and reload the page",
      "Confirm the write hits an authenticated API",
      "Check that other users cannot edit this profile",
    ],
    users: [
      "Load the list with no rows",
      "Confirm the endpoint requires a session",
      "Check that one user cannot read another user's record",
    ],
    other: [
      "Walk the connection path in the files below",
      "Try the happy path and one invalid input",
      "Check any route this feature claims to protect",
    ],
  };

  const merged = [...fromFindings];
  for (const item of defaults[kind]) {
    if (merged.length >= 3) break;
    if (!merged.some((m) => m.toLowerCase().includes(item.toLowerCase().slice(0, 18)))) {
      merged.push(item);
    }
  }
  return merged.slice(0, 3);
}

function stripPeriod(s: string): string {
  return s.replace(/\.+$/, "").trim();
}

function uniqueEvidence(items: XRayEvidence[]): XRayEvidence[] {
  const seen = new Set<string>();
  const out: XRayEvidence[] = [];
  for (const item of items) {
    if (!item.file) continue;
    const key = `${item.file}:${item.startLine ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 8);
}

function decorateNodes(
  nodes: FlowNode[],
  records: KnowledgeRecord[],
): XRayNode[] {
  return nodes.map((node) => {
    const rec = records.find(
      (r) =>
        (node.file && r.file === node.file) ||
        norm(r.name) === norm(node.label.replace(/\(\)$/, "")),
    );
    return {
      ...node,
      role: rec?.purpose || kindRole(node.kind),
    };
  });
}

function pageFeatureName(title: string, path: string): string {
  const route = title.replace(/^Page\s+/i, "").trim();
  if (!route || route === "home" || route === "/") return "Home";
  if (route.startsWith("/")) return featureNameFromRoute(route);
  const fromPath = path.match(/\/([^/]+)\/page\.(tsx|jsx|ts|js)$/);
  if (fromPath?.[1]) return featureNameFromRoute(`/${fromPath[1]}`);
  return route;
}

function mapFrontendKind(kind: string): FlowNode["kind"] {
  if (kind === "api") return "api";
  if (kind === "component") return "component";
  if (kind === "page") return "page";
  return "other";
}

function synthesizeFromFrontend(
  scan: FrontendArchScanResult,
): FeatureFlow[] {
  const pages = scan.nodes.filter((n) => n.kind === "page");
  const apis = scan.nodes.filter((n) => n.kind === "api");
  const usedApiIds = new Set<string>();
  const features: FeatureFlow[] = [];

  for (const page of pages) {
    const name = pageFeatureName(page.title, page.span.path);
    const nodes: FlowNode[] = [
      {
        id: page.id,
        label: name === "Home" ? "Home Page" : `${name} Page`,
        kind: "page",
        file: page.span.path,
      },
    ];
    const childIds = scan.edges
      .filter((edge) => edge.from === page.id)
      .map((edge) => edge.to);
    for (const id of childIds) {
      const child = scan.nodes.find((node) => node.id === id);
      if (!child) continue;
      if (child.kind === "api") usedApiIds.add(child.id);
      if (nodes.some((node) => node.file && node.file === child.span.path)) continue;
      nodes.push({
        id: child.id,
        label: child.title,
        kind: mapFrontendKind(child.kind),
        file: child.span.path,
      });
      if (nodes.length >= 12) break;
    }
    features.push({
      id: page.id,
      name,
      title: name,
      nodes,
      explanation: `${name} is a screen in this app (${page.span.path}).`,
    });
  }

  for (const api of apis) {
    if (usedApiIds.has(api.id)) continue;
    if (features.some((feature) => feature.nodes.some((node) => node.file === api.span.path))) {
      continue;
    }
    const route = api.title.replace(/^API\s+/i, "").split(" ")[0] || api.span.path;
    const name = `${featureNameFromRoute(route.startsWith("/") ? route : `/${route}`)} API`;
    features.push({
      id: api.id,
      name,
      title: name,
      nodes: [
        {
          id: api.id,
          label: api.title,
          kind: "api",
          file: api.span.path,
        },
      ],
      explanation: `${name} has no matching screen in this scan.`,
    });
  }

  return features;
}

function mergeFlows(primary: FeatureFlow[], extra: FeatureFlow[]): FeatureFlow[] {
  const out = primary.map((feature) => ({
    ...feature,
    nodes: [...feature.nodes],
  }));
  const knownFiles = new Set(
    out.flatMap((feature) =>
      feature.nodes.map((node) => node.file).filter((file): file is string => Boolean(file)),
    ),
  );

  for (const flow of extra) {
    const novel = flow.nodes.filter((node) => node.file && !knownFiles.has(node.file));
    if (novel.length === 0) continue;
    const host = out.find((feature) =>
      feature.nodes.some((node) =>
        flow.nodes.some((extraNode) => extraNode.file && node.file === extraNode.file),
      ),
    );
    if (host) {
      for (const node of novel) {
        if (host.nodes.length >= 12) break;
        host.nodes.push(node);
        if (node.file) knownFiles.add(node.file);
      }
      continue;
    }
    const nodes = novel.length === flow.nodes.length ? flow.nodes : novel;
    out.push({ ...flow, nodes: nodes.slice(0, 12) });
    for (const node of nodes) {
      if (node.file) knownFiles.add(node.file);
    }
  }
  return out;
}

function exploreTarget(feature: {
  findings: XRayFinding[];
  nodes: XRayNode[];
}): XRayFeature["explore"] {
  const arch = feature.findings.find((f) => f.source === "architecture");
  if (arch) {
    return { tab: "backend", findingId: arch.id };
  }
  const front = feature.findings.find((f) => f.source === "frontend");
  const page = feature.nodes.find((n) => n.kind === "page" && n.file);
  if (front) {
    return {
      tab: "frontend",
      findingId: front.id,
      pagePath: page?.file || front.evidence[0]?.file,
    };
  }
  if (page?.file) {
    return { tab: "frontend", pagePath: page.file };
  }
  return { tab: "backend" };
}

const FEATURE_CAP = 80;

export function buildXRay(input: {
  index?: DataIndex | null;
  frontend?: FrontendArchScanResult | null;
  fullName?: string;
  appName?: string;
  ref?: string;
}): XRayReport {
  const index = input.index ?? null;
  const frontend = input.frontend ?? null;
  const fullName = index?.fullName || frontend?.fullName || input.fullName || "";
  const appName =
    input.appName ||
    index?.appName ||
    fullName.split("/")[1] ||
    "Application";
  const ref = index?.ref || frontend?.ref || input.ref || "main";

  const seedFeatures = index?.features?.length
    ? index.features
    : [];
  const frontendFlows = frontend ? synthesizeFromFrontend(frontend) : [];
  const flows = mergeFlows(seedFeatures, frontendFlows);

  const records = index?.records ?? [];
  const architecture: ArchitectureReport | undefined = index?.architecture;
  const archFindings = architecture?.findings ?? [];
  const frontFindings = frontend?.findings ?? [];

  const drafts = flows.map((flow) => {
    const kind = classifyFeatureKind(featureHay(flow));
    const name = flow.name?.trim() || friendlyFeatureName(kind, flow.title);
    return {
      id: flow.id || kind,
      kind,
      name,
      nodes: decorateNodes(flow.nodes, records),
      seed: flow.explanation,
      findings: [] as XRayFinding[],
    };
  });

  const candidates: Array<{
    finding: XRayFinding;
    extra?: { nodeIds?: string[]; flow?: string[] };
  }> = [
    ...archFindings.map((f) => ({
      finding: fromArchitectureFinding(f),
      extra: { nodeIds: f.nodeIds, flow: f.flow },
    })),
    ...frontFindings.map((f) => ({ finding: fromFrontendFinding(f) })),
  ];

  for (const candidate of candidates) {
    let best = -1;
    let bestScore = 0;
    drafts.forEach((draft, i) => {
      const score = scoreFinding(candidate.finding, draft, candidate.extra);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && bestScore > 0) {
      const already = drafts[best]!.findings.some(
        (f) => f.id === candidate.finding.id,
      );
      if (!already) drafts[best]!.findings.push(candidate.finding);
    }
  }

  const features: XRayFeature[] = drafts.map((draft) => {
    const findings = [...draft.findings].sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity),
    );
    const relevantCode = uniqueEvidence([
      ...draft.nodes
        .filter((n) => n.file)
        .map((n) => ({ file: n.file as string })),
      ...findings.flatMap((f) => f.evidence),
    ]);
    const status = statusFor({
      findings,
      nodes: draft.nodes,
      relevantCode,
    });
    return {
      id: draft.id,
      kind: draft.kind,
      name: draft.name,
      title: draft.name,
      status,
      headline: headlineFor(draft.name, findings),
      explanation: beginnerExplanation({
        name: draft.name,
        kind: draft.kind,
        nodes: draft.nodes,
        findings,
        seed: draft.seed,
      }),
      connections: draft.nodes.map((n) => n.label),
      nodes: draft.nodes,
      findings,
      relevantCode,
      verifyNext: verifyNextFor(draft.kind, findings),
      explore: exploreTarget({ findings, nodes: draft.nodes }),
    };
  });

  features.sort((a, b) => {
    const statusRank = {
      needs_review: 0,
      connections_found: 1,
      not_verified: 2,
    } as const;
    const ds = statusRank[a.status] - statusRank[b.status];
    if (ds !== 0) return ds;
    return a.name.localeCompare(b.name);
  });

  const capped = features.slice(0, FEATURE_CAP);
  const needsReviewCount = capped.filter((f) => f.status === "needs_review").length;

  const source: XRayReport["source"] =
    index?.source === "ai" && frontend ? "mixed" : index?.source === "ai" ? "ai" : "heuristic";

  return {
    appName,
    fullName,
    ref,
    featureCount: capped.length,
    needsReviewCount,
    connectedCount: capped.filter((f) => f.status === "connections_found").length,
    notVerifiedCount: capped.filter((f) => f.status === "not_verified").length,
    source,
    truncated:
      Boolean(frontend?.truncated) ||
      index?.status === "partial" ||
      features.length > FEATURE_CAP,
    features: capped,
    builtAt: new Date().toISOString(),
  };
}

export function nodeBeginnerBlurb(node: XRayNode, feature: XRayFeature): string {
  const hits = feature.findings.filter((f) =>
    f.evidence.some(
      (e) => node.file && (e.file === node.file || e.file.endsWith(node.file)),
    ),
  );
  const loc = node.file ? ` See ${node.file}.` : "";
  if (hits[0]) {
    return `${node.label} is the ${kindRole(node.kind).toLowerCase()} in ${feature.name}. ${hits[0].summary}${loc}`;
  }
  return `${node.label} is the ${kindRole(node.kind).toLowerCase()} in ${feature.name}. ${node.role}.${loc}`;
}
