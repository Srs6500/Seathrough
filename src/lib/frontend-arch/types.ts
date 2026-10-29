import type {
  FlowEdge,
  FlowNode,
  IndexedFramework,
} from "@/lib/data-flow/types";

export type FrontendArchSeverity = "error" | "warning" | "info";
export type FrontendArchVerification = "confirmed" | "suspected";

export type FrontendArchCategory =
  | "component_connections"
  | "buttons_and_forms"
  | "api_integration"
  | "navigation"
  | "accessibility"
  | "code_quality";

export type FrontendArchFinding = {
  id: string;
  category: FrontendArchCategory;
  severity: FrontendArchSeverity;
  verification: FrontendArchVerification;
  title: string;
  summary: string;
  /** Graph node id when the finding maps to a symbol. */
  nodeId?: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet?: string;
  suggestedFix: string;
};

/** What the static frontend scanner covers today (and what it does not). */
export const FRONTEND_ARCH_CHECKS = [
  {
    id: "component_connections",
    label: "Component connections",
    detail: "Unresolved local/@ imports",
  },
  {
    id: "buttons_and_forms",
    label: "Buttons and forms",
    detail: "Empty handlers; submit without fetch/nav",
  },
  {
    id: "api_integration",
    label: "API integration",
    detail: "fetch(/api/…) with no route; missing catch",
  },
  {
    id: "navigation",
    label: "Navigation",
    detail: "href to routes with no matching page",
  },
  {
    id: "accessibility",
    label: "Accessibility (static)",
    detail: "img without alt; inputs without labels",
  },
] as const;

export type FrontendArchScanResult = {
  fullName: string;
  ref: string;
  framework: IndexedFramework;
  fileCount: number;
  truncated: boolean;
  /** True when 0 findings should not be read as “the app is clean”. */
  incomplete: boolean;
  warnings: string[];
  /** Level-1/2 graph: pages, components, APIs, and connections found in code. */
  nodes: FlowNode[];
  edges: FlowEdge[];
  findings: FrontendArchFinding[];
  checks: Array<{
    id: string;
    label: string;
    detail: string;
    status: "ran" | "limited";
  }>;
  stats: {
    pages: number;
    components: number;
    apis: number;
    connections: number;
    errors: number;
    warnings: number;
  };
  scannedAt: string;
};
