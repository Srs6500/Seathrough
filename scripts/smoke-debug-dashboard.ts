import assert from "node:assert/strict";
import {
  buildDashboardData,
  parseSourceRefs,
} from "../src/lib/bug-analyzer/debugEvents";

const refs = parseSourceRefs(
  `Error: boom
    at POST (webpack-internal:///(rsc)/./src/app/api/health/route.ts:12:11)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`,
);
assert.ok(refs.some((r) => r.path.includes("api/health/route.ts")));
assert.equal(refs[0]?.line, 12);

const data = buildDashboardData({
  collectorOk: true,
  collectorUrl: "http://127.0.0.1:4319",
  project: "smoke",
  events: [
    {
      kind: "request",
      id: "e1",
      createdAt: new Date().toISOString(),
      phase: "end",
      request: {
        id: "req_1",
        method: "GET",
        url: "http://localhost:3000/api/health",
        path: "/api/health",
        statusCode: 500,
        startedAt: new Date().toISOString(),
        durationMs: 12,
        errorIds: ["err_1"],
      },
    },
    {
      kind: "error",
      id: "err_1",
      createdAt: new Date().toISOString(),
      error: {
        id: "err_1",
        requestId: "req_1",
        name: "Error",
        message: "boom",
        stack: "Error: boom\n    at POST (./src/app/api/health/route.ts:12:11)",
        path: "/api/health",
        method: "GET",
        createdAt: new Date().toISOString(),
      },
    },
  ],
});

assert.equal(data.failedRequests.length, 1);
assert.equal(data.errors.length, 1);
assert.ok(data.errors[0]!.sourceRefs.length > 0);

console.log("smoke-debug-dashboard: ok", {
  failed: data.failedRequests[0]?.path,
  source: data.errors[0]?.sourceRefs[0],
});
