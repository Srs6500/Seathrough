import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { analyzeNextRepo } from "../src/lib/bug-analyzer/analyzeRepo";
import type { RepoSourceFile } from "../src/lib/data-flow/repoFiles";

function loadFixture(root: string): RepoSourceFile[] {
  const files: RepoSourceFile[] = [];
  function walk(dir: string, prefix: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
        continue;
      }
      const content = readFileSync(full, "utf8");
      files.push({ path: rel, content, size: Buffer.byteLength(content) });
    }
  }
  walk(root, "");
  return files;
}

const files = loadFixture(join(process.cwd(), "fixtures/data-flow/expense"));
const analysis = analyzeNextRepo({
  fullName: "acme/expense",
  ref: "main",
  files,
  truncated: false,
});

assert.equal(analysis.frameworkOk, true);
assert.ok(analysis.apiRoutes.some((r) => r.route.includes("/api/orders")));
assert.ok(analysis.functions.some((f) => f.name === "POST" || f.name === "CheckoutForm"));
assert.ok(analysis.files.some((f) => f.path.includes("route.ts")));
assert.ok(analysis.pages.some((p) => p.route.includes("checkout")));

console.log("smoke-bug-analyzer: ok", {
  apiRoutes: analysis.apiRoutes.map((r) => r.route),
  functions: analysis.functions.map((f) => f.name),
  files: analysis.files.map((f) => f.path),
});
