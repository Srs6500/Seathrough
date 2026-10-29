import type { FeatureFlow, FlowNode } from "@/lib/bug-analyzer/buildDataIndex";

export type XRayFeatureKind =
  | "auth"
  | "dashboard"
  | "payments"
  | "settings"
  | "users"
  | "other";

export type XRayFeatureStatus =
  | "needs_review"
  | "connections_found"
  | "not_verified";

export type XRayFindingSource = "architecture" | "frontend";

export type XRayEvidence = {
  file: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
  note?: string;
};

export type XRayFinding = {
  id: string;
  title: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low" | "error" | "warning" | "info";
  status: "confirmed" | "likely" | "unknown" | "suspected";
  category: string;
  source: XRayFindingSource;
  evidence: XRayEvidence[];
  inferredIntent?: string;
  contradiction?: string;
  fixSuggestion?: string;
};

export type XRayNode = FlowNode & {
  role: string;
};

export type XRayFeature = {
  id: string;
  kind: XRayFeatureKind;
  name: string;
  title: string;
  status: XRayFeatureStatus;
  headline: string;
  explanation: string;
  connections: string[];
  nodes: XRayNode[];
  findings: XRayFinding[];
  relevantCode: XRayEvidence[];
  verifyNext: string[];
  explore: {
    tab: "frontend" | "backend";
    findingId?: string;
    pagePath?: string;
  };
};

export type XRayReport = {
  appName: string;
  fullName: string;
  ref: string;
  featureCount: number;
  needsReviewCount: number;
  connectedCount: number;
  notVerifiedCount: number;
  source: "heuristic" | "ai" | "mixed";
  truncated: boolean;
  features: XRayFeature[];
  builtAt: string;
};

export type XRayAskPayload = {
  question: string;
  feature: Pick<
    XRayFeature,
    "name" | "headline" | "explanation" | "connections" | "verifyNext"
  > & {
    findings: Array<Pick<XRayFinding, "title" | "summary" | "evidence" | "contradiction">>;
    relevantCode: XRayEvidence[];
    selectedNode?: { label: string; kind: string; file?: string };
  };
};

export type XRayAskResult = {
  answer: string;
  citations: Array<{ file: string; startLine?: number }>;
  source: "ai" | "heuristic";
};

export type { FeatureFlow, FlowNode };
