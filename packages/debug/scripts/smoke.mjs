import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  init,
  captureException,
  beginRequest,
  endRequest,
  listEvents,
  clearEvents,
  withSeethroughDebug,
} from "../dist/index.js";

const dir = mkdtempSync(join(tmpdir(), "seethrough-debug-"));
clearEvents();

const runtime = init({
  enabled: true,
  dir,
  collector: false,
  project: "smoke",
});

// Force a dedicated high port via re-init options already applied; collector may use 4319.
assert.equal(runtime.enabled, true);

const req = beginRequest({
  method: "POST",
  url: "http://localhost:3000/api/orders",
  headers: {
    authorization: "Bearer secret-token",
    "content-type": "application/json",
  },
  bodyPreview: { total: 42, password: "nope" },
});
assert.equal(req.headers.authorization, "[redacted]");
assert.ok(req.bodyPreview?.includes("[redacted]"));
assert.ok(req.bodyPreview?.includes("42"));

captureException(new Error("payment failed"), { source: "smoke" });
endRequest(req, 500, new Error("handler failed"));

const events = listEvents(50);
assert.ok(events.some((e) => e.kind === "error"));
assert.ok(
  events.some(
    (e) =>
      e.kind === "request" && (e.phase === "end" || e.phase === "error"),
  ),
);

const jsonl = readFileSync(join(dir, "events.jsonl"), "utf8");
assert.ok(jsonl.includes("payment failed"));
assert.ok(!jsonl.includes("secret-token"));
assert.ok(!jsonl.includes("nope"));

const handler = withSeethroughDebug(async () => {
  throw new Error("wrapped boom");
});
await assert.rejects(() =>
  handler(new Request("http://localhost/api/x", { method: "GET" })),
);

rmSync(dir, { recursive: true, force: true });
console.log("@seethrough/debug smoke: ok");
