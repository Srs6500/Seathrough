/** Shared Data Flow map types (Next.js / TypeScript). */

export type Certainty = "confirmed" | "guess";

export type CodeSpan = {
  path: string;
  startLine: number;
  endLine: number;
  snippet?: string;
};

export type FlowNodeKind =
  | "page"
  | "component"
  | "api"
  | "database"
  | "lib"
  | "other";

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  title: string;
  summary: string;
  span: CodeSpan;
  certainty: Certainty;
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  certainty: Certainty;
  reason: string;
};

export type IndexedFramework =
  | "nextjs-ts"
  | "react"
  | "express"
  | "fastapi"
  | "go"
  | "unknown";

export type FlowMapResult = {
  fullName: string;
  ref: string;
  framework: IndexedFramework;
  question: string;
  fileCount: number;
  truncated: boolean;
  warnings: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type IndexedSymbol = {
  id: string;
  kind: FlowNodeKind;
  title: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  /** Lowercased tokens for ranking. */
  tokens: string[];
  /** Route path like /checkout or /api/orders. */
  route?: string;
  /** Exported or component names. */
  names: string[];
};

export type IndexedEdge = {
  fromId: string;
  toId: string;
  label?: string;
  certainty: Certainty;
  reason: string;
};

export type RepoIndex = {
  frameworkOk: boolean;
  warnings: string[];
  symbols: IndexedSymbol[];
  edges: IndexedEdge[];
  frameworks?: string[];
};
