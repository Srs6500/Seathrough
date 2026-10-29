export type TreeSitterSymbol = {
  kind: string;
  name: string;
  type: string;
  line: number;
  column: number;
};

export type TreeSitterError = {
  type: string;
  line: number;
  column: number;
  text: string;
};

export type TreeSitterFile = {
  path: string;
  language: string | null;
  ok: boolean;
  skipped: boolean;
  reason: string | null;
  rootType: string | null;
  nodeCount: number;
  errorCount: number;
  hasError: boolean;
  sexp: string;
  sexpTruncated: boolean;
  symbols: TreeSitterSymbol[];
  errors: TreeSitterError[];
  content?: string;
};

export type FileGraphRole = "page" | "api_route" | "component" | "service";
export type FileGraphEdgeType = "renders" | "calls";

export type FileGraphNode = {
  id: string;
  role: FileGraphRole;
};

export type FileGraphEdge = {
  source: string;
  target: string;
  type: FileGraphEdgeType;
};

export type FileRelationshipGraph = {
  nodes: FileGraphNode[];
  edges: FileGraphEdge[];
};

export type ClusterSummaryFile = {
  path: string;
  role: FileGraphRole | string;
  route?: string;
  symbols: string[];
};

export type FeatureCluster = {
  cluster_id: string;
  files: string[];
  source?: "feature" | "route" | "shared" | "louvain";
  label?: string;
  entries?: string[];
  shared_files?: string[];
  name?: string;
  category?: "feature" | "infrastructure" | "unknown";
  description?: string;
  entry_points?: string[];
  evidence_files?: string[];
  needs_split?: boolean;
  confidence?: "high" | "medium" | "low";
  labeled_by?: "llm" | "heuristic";
  summary?: {
    files: ClusterSummaryFile[];
    relationships: string[];
  };
};

export type TreeSitterParseIssue = {
  path: string;
  errorCount: number;
  line?: number;
  text?: string;
};

export type FeatureTestStatus = "pass" | "fail" | "inconclusive" | "blocked";
export type FeatureVerificationStatus =
  | "not_tested"
  | "passed"
  | "failed"
  | "inconclusive"
  | "blocked";

export type FeatureTestOrigin = "template" | "llm" | "repo" | "static";

export type RestrictedTestAction = {
  type: string;
  path?: string;
  target?: string;
  value?: string;
  key?: string;
};

export type RestrictedTestAssertion = {
  type: string;
  target?: string;
  path?: string;
  resource?: string;
  text?: string;
};

export type FeatureTestResult = {
  id: string;
  name: string;
  type: "static" | "integration" | "browser" | "repo";
  origin?: FeatureTestOrigin | "mixed" | null;
  assertion: string;
  status: FeatureTestStatus;
  explanation: string;
  failing_step: string | null;
  source: string | null;
  suggested_fix: string | null;
  requires: string[];
};

export type FeatureGeneratedTest = {
  path: string;
  contents?: string;
  ran?: boolean;
  origin?: FeatureTestOrigin | "mixed";
  specs?: Array<{
    name?: string;
    origin?: string;
    actions?: RestrictedTestAction[];
    assertions?: RestrictedTestAssertion[];
  }>;
  evidence?: {
    login_route?: string;
    dashboard_route?: string | null;
    session_api?: string | null;
    source_files?: string[];
  };
};

export type FeatureVerification = {
  feature_id: string;
  family: string;
  verification_status: FeatureVerificationStatus;
  tests: FeatureTestResult[];
  generated_test?: FeatureGeneratedTest;
  summary?: string;
  failing_step?: string | null;
  source?: string | null;
  suggested_fix?: string | null;
};

export type StoredFeature = {
  feature_id: string;
  name: string;
  description: string;
  entry_points: string[];
  primary_files: string[];
  shared_dependencies: string[];
  related_features: string[];
  verification_status: FeatureVerificationStatus;
  verification?: FeatureVerification;
  evidence?: {
    cluster_id?: string;
    source?: string;
    category?: string;
    confidence?: string;
    labeled_by?: string;
    relationships?: string[];
    entries?: string[];
  };
};

export type FeatureFileIndex = Record<
  string,
  { primary: string[]; shared: string[] }
>;

export type FeatureCatalog = {
  features: StoredFeature[];
  infrastructure: StoredFeature[];
  graph: FileRelationshipGraph;
  file_index: FeatureFileIndex;
  repo_checks?: FeatureTestResult[];
};

export type TreeSitterParseResult = {
  ok: boolean;
  error?: string;
  fullName: string | null;
  ref: string | null;
  truncated: boolean;
  fileCount: number;
  parsedCount: number;
  skippedCount: number;
  errorCount: number;
  errorFileCount?: number;
  parseIssues?: TreeSitterParseIssue[];
  languages: Record<string, number>;
  graph?: FileRelationshipGraph;
  clusters?: FeatureCluster[];
  catalog?: FeatureCatalog;
  guide?: unknown;
  labeling?: {
    llm_required?: Record<string, boolean | string>;
    llm_calls?: number;
    cache_hits?: number;
    heuristic?: number;
    snippets_used?: number;
    refined?: boolean;
  };
  files: TreeSitterFile[];
};
