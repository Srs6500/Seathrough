export type RelationOrigin = "declared" | "implicit";
export type FactOrigin = "schema" | "code" | "heuristic" | "llm";
export type RelationKind = "one-to-one" | "one-to-many" | "many-to-many";
export type CodeOperation =
  | "create"
  | "update"
  | "delete"
  | "read"
  | "upsert"
  | "count"
  | "other";

export type SchemaField = {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  isId: boolean;
  isUnique: boolean;
  isRelation: boolean;
  defaultValue: string | null;
  dbName: string | null;
  doc: string | null;
};

export type SchemaRelation = {
  id: string;
  fromTable: string;
  toTable: string;
  fromField: string;
  toField: string | null;
  kind: RelationKind;
  origin: RelationOrigin;
  onDelete: string | null;
  name: string | null;
};

export type CodeUsage = {
  tableId: string;
  file: string;
  line: number;
  operation: CodeOperation;
  callee: string;
  snippet: string;
  functionName: string | null;
};

export type SampleRow = {
  values: Record<string, string>;
};

export type FieldNote = {
  name: string;
  note: string;
  origin: FactOrigin;
};

export type TableGuide = {
  id: string;
  modelName: string;
  tableName: string;
  purpose: string;
  purposeOrigin: FactOrigin;
  importantFields: FieldNote[];
  connections: string[];
  behavior: string;
  behaviorOrigin: FactOrigin;
  fields: SchemaField[];
  relationIds: string[];
  usages: CodeUsage[];
  sampleRows: SampleRow[];
  concept: string;
};

export type ConceptGroup = {
  id: string;
  label: string;
  summary: string;
  tableIds: string[];
};

export type SuggestedAction = {
  id: string;
  question: string;
  tableIds: string[];
};

export type UploadedFile = {
  path: string;
  content: string;
};

export type DatabaseKind = "relational" | "document" | "unknown";

export type DatabaseInfo = {
  kind: DatabaseKind;
  provider: string | null;
  providerLabel: string;
  summary: string;
};

export type SchemaStats = {
  tables: number;
  fields: number;
  primaryKeys: number;
  foreignKeys: number;
  uniqueKeys: number;
  relations: number;
  oneToMany: number;
  oneToOne: number;
  manyToMany: number;
  enums: number;
  writes: number;
  reads: number;
};

export type SchemaGuide = {
  title: string;
  overview: string;
  overviewOrigin: FactOrigin;
  database: DatabaseInfo;
  stats: SchemaStats;
  schemaSource: { path: string; content: string } | null;
  enums: string[];
  tables: TableGuide[];
  relations: SchemaRelation[];
  concepts: ConceptGroup[];
  actions: SuggestedAction[];
  warnings: string[];
  explainedBy: "llm" | "heuristic";
  files: Array<{ path: string; kind: "schema" | "source" }>;
  knowledge?: KnowledgeGraph;
  backend?: BackendGuide;
};

export type SchemaAskStep = {
  step: number;
  text: string;
  tableId: string | null;
  file: string | null;
  origin: FactOrigin;
};

export type KnowledgeNodeKind = "list" | "setting" | "idea" | "secret";
export type KnowledgeEdgeKind =
  | "has-many"
  | "belongs-to"
  | "remembers"
  | "part-of"
  | "controls";

export type KnowledgeNode = {
  id: string;
  kind: KnowledgeNodeKind;
  label: string;
  summary: string;
  tableId: string | null;
};

export type KnowledgeEdge = {
  id: string;
  from: string;
  to: string;
  kind: KnowledgeEdgeKind;
  label: string;
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
};

export type SchemaAskResult = {
  answer: string;
  tableIds: string[];
  files: string[];
  walkthrough: SchemaAskStep[];
  graph: KnowledgeGraph;
};

export type BackendStepKind = "action" | "decision" | "database" | "service";
export type BackendScenarioId = "success" | "failure";

export type BackendStepSample = {
  enter: string;
  happen: string;
  leave: string;
};

export type BackendTech = {
  method: string | null;
  route: string | null;
  functionName: string | null;
  file: string | null;
  line: number | null;
  callee: string | null;
  snippet: string | null;
  tableId: string | null;
};

export type BackendFieldLink = {
  human: string;
  field: string;
};

export type BackendStep = {
  id: string;
  kind: BackendStepKind;
  label: string;
  summary: string;
  sample: BackendStepSample;
  tech: BackendTech | null;
  fields: BackendFieldLink[];
  next: string | null;
  yesTo: string | null;
  noTo: string | null;
};

export type BackendScenario = {
  id: BackendScenarioId;
  label: string;
  outcome: string;
};

export type BackendFeature = {
  id: string;
  title: string;
  when: string;
  summary: string;
  tableIds: string[];
  startId: string;
  steps: BackendStep[];
  scenarios: BackendScenario[];
};

export type BackendGuide = {
  headline: string;
  blurb: string;
  simulated: true;
  features: BackendFeature[];
};

export type BackendAskResult = {
  answer: string;
  featureId: string | null;
  tableIds: string[];
  files: string[];
  walkthrough: SchemaAskStep[];
};
