import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildArchitectureReport } from "../src/lib/bug-analyzer/analyzeLogicalGaps";
import { buildAnalysisAndIndex } from "../src/lib/bug-analyzer/buildDataIndex";
import type { RepoSourceFile } from "../src/lib/data-flow/repoFiles";
import { buildFrontendArchitecture } from "../src/lib/frontend-arch/buildArchitecture";
import { buildXRay } from "../src/lib/xray/buildXRay";
import { heuristicFeatureAnswer } from "../src/lib/xray/explain";

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
      files.push({ path: rel.replace(/\\/g, "/"), content, size: Buffer.byteLength(content) });
    }
  }
  walk(root, "");
  return files;
}

const loginFiles = loadFixture(
  join(process.cwd(), "fixtures/frontend-arch/broken-login"),
);
const { analysis, index } = buildAnalysisAndIndex({
  fullName: "acme/broken-login",
  ref: "main",
  scope: "repo",
  focusPath: null,
  files: loginFiles,
  truncated: false,
});
const architecture = buildArchitectureReport({
  analysis,
  files: loginFiles,
  records: index.records,
  pages: index.pages,
  features: index.features,
});
const frontend = buildFrontendArchitecture({
  files: loginFiles,
  fullName: "acme/broken-login",
  ref: "main",
  truncated: false,
});
const xray = buildXRay({
  index: { ...index, architecture },
  frontend,
});

assert.ok(xray.featureCount >= 2, `expected ≥2 features, got ${xray.featureCount}`);
const auth = xray.features.find((f) => f.kind === "auth");
assert.ok(auth, "expected a login feature");
assert.equal(auth!.name, "Login");
assert.equal(auth!.status, "needs_review");
assert.ok(auth!.findings.length > 0, "auth feature should carry evidence");
assert.ok(
  auth!.relevantCode.some((c) => /login/i.test(c.file)),
  "auth feature should cite login files",
);
assert.ok(auth!.connections.length >= 1, "auth feature should show a connection path");
assert.ok(auth!.verifyNext.length >= 2, "auth feature should suggest checks");
assert.ok(auth!.explanation.length > 40, "auth explanation should be readable");
assert.equal(auth!.explore.tab === "backend" || auth!.explore.tab === "frontend", true);
assert.ok(
  auth!.findings.some((f) => f.id === "login-no-verify"),
  "login credential gap should sit on Login",
);
assert.ok(
  !auth!.findings.some((f) => f.id === "dashboard-no-auth"),
  "dashboard auth gap should not leak onto Login",
);

const dashboard = xray.features.find((f) => f.kind === "dashboard");
assert.ok(dashboard, "expected Dashboard feature");
assert.ok(
  dashboard!.findings.some((f) => f.id === "dashboard-no-auth"),
  "dashboard should own its missing-auth finding",
);

const empty = buildXRay({
  index: null,
  frontend: null,
  fullName: "acme/empty",
  appName: "empty",
});
assert.equal(empty.featureCount, 0);

const ask = heuristicFeatureAnswer({
  question: "Does login actually check the password?",
  feature: {
    name: auth!.name,
    headline: auth!.headline,
    explanation: auth!.explanation,
    connections: auth!.connections,
    verifyNext: auth!.verifyNext,
    findings: auth!.findings.map((f) => ({
      title: f.title,
      summary: f.summary,
      contradiction: f.contradiction,
      evidence: f.evidence,
    })),
    relevantCode: auth!.relevantCode,
  },
});
assert.ok(ask.answer.length > 20);
assert.equal(ask.source, "heuristic");

const expenseFiles = loadFixture(join(process.cwd(), "fixtures/data-flow/expense"));
const expenseBuilt = buildAnalysisAndIndex({
  fullName: "acme/expense",
  ref: "main",
  scope: "repo",
  focusPath: null,
  files: expenseFiles,
  truncated: false,
});
const expenseArch = buildArchitectureReport({
  analysis: expenseBuilt.analysis,
  files: expenseFiles,
  records: expenseBuilt.index.records,
  pages: expenseBuilt.index.pages,
  features: expenseBuilt.index.features,
});
const expenseFront = buildFrontendArchitecture({
  files: expenseFiles,
  fullName: "acme/expense",
  ref: "main",
  truncated: false,
});
const expenseXray = buildXRay({
  index: { ...expenseBuilt.index, architecture: expenseArch },
  frontend: expenseFront,
});
assert.ok(
  expenseXray.features.some((f) => f.kind === "payments"),
  `expected a payments feature, got ${expenseXray.features.map((f) => f.kind).join(",")}`,
);

console.log("smoke-xray: ok", {
  loginFeatures: xray.features.map((f) => `${f.name}:${f.status}`),
  authFindings: auth!.findings.map((f) => f.id),
  expenseFeatures: expenseXray.features.map((f) => `${f.name}:${f.status}`),
});
