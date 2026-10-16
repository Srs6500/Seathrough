import { createServer, type Server } from "node:http";
import { createStore, type DebugStore } from "./store.js";
import { isDebugEnabled } from "./env.js";
import { newId } from "./ids.js";
import { currentRequest } from "./context.js";
import { redactBodyPreview, redactHeaders } from "./redact.js";
import type {
  CapturedError,
  DebugEvent,
  DebugSpan,
  RequestTrace,
  SeethroughDebugOptions,
} from "./types.js";

type RuntimeState = {
  options: SeethroughDebugOptions;
  store: DebugStore;
  enabled: boolean;
  hooksInstalled: boolean;
  collector?: Server;
  project?: string;
};

const GLOBAL_KEY = "__seethrough_debug_runtime__" as const;

type GlobalRuntime = typeof globalThis & {
  [GLOBAL_KEY]?: RuntimeState;
};

/** One runtime across Turbopack/webpack module copies (instrumentation vs routes). */
function getState(): RuntimeState | null {
  return (globalThis as GlobalRuntime)[GLOBAL_KEY] ?? null;
}

function setState(next: RuntimeState) {
  (globalThis as GlobalRuntime)[GLOBAL_KEY] = next;
}

export function getRuntime(): RuntimeState | null {
  return getState();
}

export function init(options: SeethroughDebugOptions = {}): RuntimeState {
  const existing = getState();
  if (existing) {
    existing.options = { ...existing.options, ...options };
    existing.enabled = isDebugEnabled(existing.options);
    if (options.project) existing.project = options.project;
    return existing;
  }

  const enabled = isDebugEnabled(options);
  const store = createStore(options);
  const state: RuntimeState = {
    options,
    store,
    enabled,
    hooksInstalled: false,
    project: options.project || process.env.SEETHROUGH_DEBUG_PROJECT,
  };
  setState(state);

  if (enabled) {
    installProcessHooks();
    const wantCollector =
      options.collector !== false &&
      process.env.SEETHROUGH_DEBUG_COLLECTOR !== "0";
    if (wantCollector) {
      startCollector(state);
    }
  }

  return state;
}

function installProcessHooks() {
  const state = getState();
  if (!state || state.hooksInstalled) return;
  state.hooksInstalled = true;

  process.on("uncaughtException", (error) => {
    captureException(error, { source: "uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    const error =
      reason instanceof Error ? reason : new Error(String(reason));
    captureException(error, { source: "unhandledRejection" });
  });
}

function emit(event: DebugEvent) {
  const state = getState();
  if (!state?.enabled) return;
  state.store.push(event);
}

export function captureException(
  error: unknown,
  meta?: Record<string, unknown>,
): CapturedError | null {
  const state = getState();
  if (!state?.enabled) return null;
  const err =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const req = currentRequest();
  const captured: CapturedError = {
    id: newId("err"),
    requestId: req?.id,
    name: err.name || "Error",
    message: err.message || String(error),
    stack: err.stack,
    digest:
      typeof (err as { digest?: string }).digest === "string"
        ? (err as { digest?: string }).digest
        : undefined,
    path: req?.path,
    method: req?.method,
    createdAt: new Date().toISOString(),
    meta: {
      project: state.project,
      ...meta,
    },
  };
  if (req) req.errorIds.push(captured.id);
  emit({
    kind: "error",
    id: captured.id,
    createdAt: captured.createdAt,
    error: captured,
  });
  return captured;
}

export function captureLog(
  level: "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) {
  const state = getState();
  if (!state?.enabled) return;
  const req = currentRequest();
  emit({
    kind: "log",
    id: newId("log"),
    createdAt: new Date().toISOString(),
    level,
    message,
    requestId: req?.id,
    meta: { project: state.project, ...meta },
  });
}

export function beginRequest(input: {
  method: string;
  url: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
  bodyPreview?: unknown;
}): RequestTrace {
  const state = getState();
  const url = input.url;
  let path = url;
  try {
    path = new URL(url, "http://localhost").pathname;
  } catch {
    path = url.split("?")[0] || url;
  }
  const request: RequestTrace = {
    id: newId("req"),
    method: input.method.toUpperCase(),
    url,
    path,
    startedAt: new Date().toISOString(),
    headers: redactHeaders(input.headers, state?.options.redactHeaders),
    bodyPreview: redactBodyPreview(input.bodyPreview),
    spans: [],
    errorIds: [],
  };
  if (state?.enabled) {
    emit({
      kind: "request",
      id: request.id,
      createdAt: request.startedAt,
      phase: "start",
      request: { ...request, spans: [...request.spans] },
    });
  }
  return request;
}

export function endRequest(
  request: RequestTrace,
  statusCode: number,
  error?: unknown,
) {
  const state = getState();
  request.statusCode = statusCode;
  request.endedAt = new Date().toISOString();
  request.durationMs =
    Date.parse(request.endedAt) - Date.parse(request.startedAt);
  if (error) captureException(error, { source: "request" });
  if (!state?.enabled) return;
  emit({
    kind: "request",
    id: request.id,
    createdAt: request.endedAt,
    phase: error ? "error" : "end",
    request: {
      ...request,
      spans: request.spans.map((s) => ({ ...s })),
      errorIds: [...request.errorIds],
    },
  });
}

export function addSpan(
  request: RequestTrace,
  name: string,
  meta?: Record<string, unknown>,
): DebugSpan {
  const span: DebugSpan = {
    id: newId("span"),
    name,
    startMs: Date.now(),
    meta,
  };
  request.spans.push(span);
  return span;
}

export function endSpan(span: DebugSpan, meta?: Record<string, unknown>) {
  span.endMs = Date.now();
  if (meta) span.meta = { ...span.meta, ...meta };
}

export function listEvents(limit = 100): DebugEvent[] {
  return getState()?.store.list(limit) ?? [];
}

export function clearEvents() {
  getState()?.store.clear();
}

function startCollector(runtime: RuntimeState) {
  if (runtime.collector) return;
  const host = runtime.options.host || process.env.SEETHROUGH_DEBUG_HOST || "127.0.0.1";
  const port = Number(
    runtime.options.port || process.env.SEETHROUGH_DEBUG_PORT || 4319,
  );

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          package: "@seethrough/debug",
          project: runtime.project ?? null,
          dir: runtime.store.dir,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const limit = Number(url.searchParams.get("limit") || 100);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ events: runtime.store.list(limit) }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/ingest") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      try {
        const event = JSON.parse(Buffer.concat(chunks).toString("utf8")) as DebugEvent;
        runtime.store.push(event);
        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON event." }));
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/clear") {
      runtime.store.clear();
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // Another process already hosts the collector — fine.
      return;
    }
  });

  server.listen(port, host, () => {
    const address = server.address();
    const bound =
      address && typeof address === "object" ? address.port : port;
    // eslint-disable-next-line no-console
    console.info(
      `[@seethrough/debug] collector on http://${host}:${bound} (events → ${runtime.store.dir})`,
    );
  });

  runtime.collector = server;
}
