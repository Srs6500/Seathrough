export type DebugEventKind = "error" | "request" | "log";

export type RequestPhase = "start" | "end" | "error";

export type DebugSpan = {
  id: string;
  parentId?: string;
  name: string;
  startMs: number;
  endMs?: number;
  meta?: Record<string, unknown>;
};

export type RequestTrace = {
  id: string;
  method: string;
  url: string;
  path: string;
  statusCode?: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  headers?: Record<string, string>;
  /** Redacted body preview (never raw secrets). */
  bodyPreview?: string;
  spans: DebugSpan[];
  errorIds: string[];
};

export type CapturedError = {
  id: string;
  requestId?: string;
  name: string;
  message: string;
  stack?: string;
  digest?: string;
  path?: string;
  method?: string;
  createdAt: string;
  meta?: Record<string, unknown>;
};

export type DebugEvent =
  | {
      kind: "error";
      id: string;
      createdAt: string;
      error: CapturedError;
    }
  | {
      kind: "request";
      id: string;
      createdAt: string;
      phase: RequestPhase;
      request: RequestTrace;
    }
  | {
      kind: "log";
      id: string;
      createdAt: string;
      level: "info" | "warn" | "error";
      message: string;
      requestId?: string;
      meta?: Record<string, unknown>;
    };

export type SeethroughDebugOptions = {
  /** Master switch. Defaults to true only when NODE_ENV=development or SEETHROUGH_DEBUG=1. */
  enabled?: boolean;
  /** Directory for jsonl + state. Default: .seethrough/debug */
  dir?: string;
  /** Max events kept in memory. Default: 500 */
  maxEvents?: number;
  /** Also POST each event to this URL (e.g. http://127.0.0.1:4319/ingest). */
  ingestUrl?: string;
  /** Start a tiny local collector HTTP server. Default: true when enabled. */
  collector?: boolean;
  /** Collector bind host. Default: 127.0.0.1 */
  host?: string;
  /** Collector port. Default: 4319 */
  port?: number;
  /** Project label stored on events. */
  project?: string;
  /** Extra header names to drop beyond defaults. */
  redactHeaders?: string[];
};
