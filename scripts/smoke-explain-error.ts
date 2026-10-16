import assert from "node:assert/strict";
import { heuristicExplain } from "../src/lib/bug-analyzer/explainError";

const e = heuristicExplain({
  message: "boom",
  method: "POST",
  path: "/api/orders",
  statusCode: 500,
  sourceRefs: [
    { path: "app/api/orders/route.ts", line: 12, raw: "at POST (...:12:11)" },
  ],
});

assert.ok(e.whatFailed.includes("POST"));
assert.ok(e.whyLikely.includes("500") || e.whyLikely.includes("boom"));
assert.equal(e.investigate[0]?.path, "app/api/orders/route.ts");
assert.ok(e.nextSteps.length >= 2);

console.log("smoke-explain-error: ok", {
  what: e.whatFailed,
  investigate: e.investigate[0],
});
