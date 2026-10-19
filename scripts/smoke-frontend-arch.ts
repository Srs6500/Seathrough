import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildFrontendArchitecture } from "../src/lib/frontend-arch/buildArchitecture";
import type { RepoSourceFile } from "../src/lib/data-flow/repoFiles";

function loadFixtureDir(dir: string): RepoSourceFile[] {
  const root = path.join(process.cwd(), dir);
  const files: RepoSourceFile[] = [];

  function walk(rel: string) {
    const abs = path.join(root, rel);
    for (const name of readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = path.join(root, childRel);
      if (statSync(childAbs).isDirectory()) {
        walk(childRel);
        continue;
      }
      const content = readFileSync(childAbs, "utf8");
      files.push({
        path: childRel.replace(/\\/g, "/"),
        content,
        size: Buffer.byteLength(content, "utf8"),
      });
    }
  }

  walk("");
  return files;
}

const files = loadFixtureDir("fixtures/frontend-arch/broken-login");
const scan = buildFrontendArchitecture({
  files,
  fullName: "fixture/broken-login",
  ref: "main",
  truncated: false,
});

assert.ok(scan.stats.pages >= 2, `expected ≥2 pages, got ${scan.stats.pages}`);
assert.ok(
  scan.stats.components >= 1,
  `expected ≥1 component, got ${scan.stats.components}`,
);
assert.ok(
  scan.edges.length >= 1,
  `expected import/connection edges, got ${scan.edges.length}`,
);
assert.ok(
  scan.findings.length >= 3,
  `expected several static findings, got ${scan.findings.length}`,
);

const categories = new Set(scan.findings.map((f) => f.category));
assert.ok(
  categories.has("buttons_and_forms") || categories.has("navigation"),
  "expected form or navigation finding",
);

const submitGap = scan.findings.find((f) =>
  /does not call|Empty onClick/i.test(f.title + f.summary),
);
assert.ok(submitGap, "expected disconnected submit handler finding");

const missingPage = scan.findings.find((f) =>
  /does-not-exist|missing page/i.test(f.title + f.summary),
);
assert.ok(missingPage, "expected broken href finding");

console.log(
  `frontend-arch smoke passed · ${scan.nodes.length} nodes · ${scan.edges.length} edges · ${scan.findings.length} findings`,
);
