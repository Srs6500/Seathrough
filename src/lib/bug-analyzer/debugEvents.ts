/** Types + helpers for the visual runtime debug dashboard. */

export type SourceRef = {
  path: string;
  line?: number;
  column?: number;
  raw: string;
};

export type DebugRequestView = {
  id: string;
  method: string;
  path: string;
  url: string;
  statusCode?: number;
  durationMs?: number;
  startedAt: string;
  endedAt?: string;
  failed: boolean;
  bodyPreview?: string;
  errorIds: string[];
  sourceRefs: SourceRef[];
};

export type DebugErrorView = {
  id: string;
  requestId?: string;
  name: string;
  message: string;
  stack?: string;
  path?: string;
  method?: string;
  createdAt: string;
  sourceRefs: SourceRef[];
};

export type DebugDashboardData = {
  collectorOk: boolean;
  collectorUrl: string;
  project: string | null;
  fetchedAt: string;
  requests: DebugRequestView[];
  errors: DebugErrorView[];
  failedRequests: DebugRequestView[];
  events: unknown[];
  message?: string;
};

type RawError = {
  id: string;
  requestId?: string;
  name: string;
  message: string;
  stack?: string;
  path?: string;
  method?: string;
  createdAt: string;
};

type RawRequest = {
  id: string;
  method: string;
  url: string;
  path: string;
  statusCode?: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  bodyPreview?: string;
  errorIds?: string[];
};

type RawEvent =
  | { kind: "error"; id: string; createdAt: string; error: RawError }
  | {
      kind: "request";
      id: string;
      createdAt: string;
      phase: "start" | "end" | "error";
      request: RawRequest;
    }
  | {
      kind: "log";
      id: string;
      createdAt: string;
      level: string;
      message: string;
    };

/** Pull file:line:col from V8 / webpack / Next stacks. */
export function parseSourceRefs(stack?: string, fallbackPath?: string): SourceRef[] {
  const refs: SourceRef[] = [];
  const seen = new Set<string>();

  if (stack) {
    const re =
      /(?:at\s+)?(?:.*?\s+)?\(?(?:(?:webpack-internal:\/\/\/|file:\/\/|\/|\.\/)?([^\s\)]+\.(?:tsx?|jsx?|mjs|cjs))):(\d+)(?::(\d+))?\)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stack)) !== null) {
      let path = m[1]!.replace(/^webpack-internal:\/\/\//, "");
      path = path.replace(/^file:\/\//, "");
      // Drop absolute prefix up to project-ish segments
      const appIdx = path.search(/(?:^|\/)(src\/|app\/|pages\/|lib\/|components\/)/);
      if (appIdx >= 0) {
        path = path.slice(appIdx).replace(/^\//, "");
      }
      const line = Number(m[2]);
      const column = m[3] ? Number(m[3]) : undefined;
      const key = `${path}:${line}:${column ?? ""}`;
      if (seen.has(key)) continue;
      if (path.includes("node_modules")) continue;
      seen.add(key);
      refs.push({
        path,
        line: Number.isFinite(line) ? line : undefined,
        column,
        raw: m[0]!,
      });
      if (refs.length >= 8) break;
    }
  }

  if (refs.length === 0 && fallbackPath) {
    refs.push({ path: fallbackPath, raw: fallbackPath });
  }
  return refs;
}

export function buildDashboardData(input: {
  events: RawEvent[];
  collectorOk: boolean;
  collectorUrl: string;
  project: string | null;
  message?: string;
}): DebugDashboardData {
  const requestsById = new Map<string, DebugRequestView>();
  const errors: DebugErrorView[] = [];

  const IGNORE_PATHS = new Set([
    "/api/bug-analyzer/debug-events",
  ]);

  for (const event of input.events) {
    if (event.kind === "request") {
      const r = event.request;
      if (IGNORE_PATHS.has(r.path)) continue;
      const failed =
        event.phase === "error" ||
        (typeof r.statusCode === "number" && r.statusCode >= 400) ||
        (r.errorIds?.length ?? 0) > 0;
      const prev = requestsById.get(r.id);
      const next: DebugRequestView = {
        id: r.id,
        method: r.method,
        path: r.path,
        url: r.url,
        statusCode: r.statusCode ?? prev?.statusCode,
        durationMs: r.durationMs ?? prev?.durationMs,
        startedAt: r.startedAt || prev?.startedAt || event.createdAt,
        endedAt: r.endedAt ?? prev?.endedAt,
        failed: failed || Boolean(prev?.failed),
        bodyPreview: r.bodyPreview ?? prev?.bodyPreview,
        errorIds: r.errorIds ?? prev?.errorIds ?? [],
        sourceRefs: parseSourceRefs(undefined, r.path.replace(/^\//, "app/") + "/route.ts"),
      };
      // Prefer API path as soft source hint for app router
      if (r.path.startsWith("/api/")) {
        const routePath = `app${r.path}/route.ts`.replace(/\/+/g, "/");
        next.sourceRefs = [{ path: routePath, raw: routePath }];
      }
      requestsById.set(r.id, next);
    }

    if (event.kind === "error") {
      const e = event.error;
      errors.push({
        id: e.id,
        requestId: e.requestId,
        name: e.name,
        message: e.message,
        stack: e.stack,
        path: e.path,
        method: e.method,
        createdAt: e.createdAt,
        sourceRefs: parseSourceRefs(e.stack, e.path),
      });
    }
  }

  // Attach error source refs onto related requests
  for (const err of errors) {
    if (!err.requestId) continue;
    const req = requestsById.get(err.requestId);
    if (!req) continue;
    req.failed = true;
    const keys = new Set(req.sourceRefs.map((s) => `${s.path}:${s.line ?? ""}`));
    for (const ref of err.sourceRefs) {
      const key = `${ref.path}:${ref.line ?? ""}`;
      if (keys.has(key)) continue;
      keys.add(key);
      req.sourceRefs.push(ref);
    }
  }

  const requests = [...requestsById.values()].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
  const failedRequests = requests.filter((r) => r.failed);
  errors.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const filteredEvents = input.events.filter((event) => {
    if (event.kind === "request" && IGNORE_PATHS.has(event.request.path)) {
      return false;
    }
    if (
      event.kind === "error" &&
      event.error.path &&
      IGNORE_PATHS.has(event.error.path)
    ) {
      return false;
    }
    return true;
  });

  return {
    collectorOk: input.collectorOk,
    collectorUrl: input.collectorUrl,
    project: input.project,
    fetchedAt: new Date().toISOString(),
    requests,
    errors,
    failedRequests,
    events: filteredEvents,
    message: input.message,
  };
}

export function collectorBaseUrl(): string {
  const host = process.env.SEETHROUGH_DEBUG_HOST || "127.0.0.1";
  const port = process.env.SEETHROUGH_DEBUG_PORT || "4319";
  return `http://${host}:${port}`;
}
