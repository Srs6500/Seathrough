import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildFlowFromQuestion } from "../src/lib/data-flow/flowFromQuestion";
import { buildNextIndex } from "../src/lib/data-flow/nextIndex";
import { parseGithubRepoInput } from "../src/lib/data-flow/parseRepoUrl";
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

const parsed = parseGithubRepoInput("https://github.com/acme/expense/tree/main");
assert.equal(parsed?.fullName, "acme/expense");
assert.equal(parsed?.ref, "main");
assert.equal(parseGithubRepoInput("not a repo"), null);
assert.equal(parseGithubRepoInput(""), null);

const files = loadFixture(
  join(process.cwd(), "fixtures/data-flow/expense"),
);
const index = buildNextIndex(files);
assert.equal(index.frameworkOk, true);

const kinds = new Set(index.symbols.map((s) => s.kind));
assert.ok(kinds.has("page"), "page");
assert.ok(kinds.has("component"), "component");
assert.ok(kinds.has("api"), "api");
assert.ok(kinds.has("database"), "database");

const map = buildFlowFromQuestion({
  index,
  question: "How does checkout save an order?",
  fullName: "acme/expense",
  ref: "main",
  fileCount: files.length,
  truncated: false,
});

assert.ok(map.nodes.some((n) => n.kind === "page"));
assert.ok(map.nodes.some((n) => n.kind === "component" || n.kind === "api"));
assert.ok(map.edges.length > 0, "expected edges");

const confirmed = map.edges.filter((e) => e.certainty === "confirmed");
assert.ok(confirmed.length > 0, "expected at least one confirmed edge");

console.log("smoke-data-flow-map: ok", {
  nodes: map.nodes.map((n) => `${n.kind}:${n.title}`),
  edges: map.edges.map((e) => `${e.certainty}:${e.label}`),
});
