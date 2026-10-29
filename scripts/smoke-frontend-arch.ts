import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  formatStackLabel,
  inferAppsFromPaths,
  nearestPackageRoot,
  refineAppsFromManifests,
  stackBadge,
} from "../src/lib/data-flow/discoverApps";
import { indexRepo } from "../src/lib/data-flow/indexRepo";
import { resolveImportPath } from "../src/lib/data-flow/nextIndex";
import type { RepoSourceFile } from "../src/lib/data-flow/repoFiles";
import { buildFrontendArchitecture } from "../src/lib/frontend-arch/buildArchitecture";

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

const nestedPaths = [
  "package.json",
  "apps/web/package.json",
  "apps/web/app/page.tsx",
  "apps/web/app/checkout/page.tsx",
  "apps/web/src/app/settings/page.tsx",
];
const nestedApps = inferAppsFromPaths(nestedPaths);
assert.equal(
  nestedApps.some((a) => a.kind === "nextjs" && a.root === "apps/web"),
  true,
  "nested Next app root should be apps/web, not src",
);
assert.equal(formatStackLabel(nestedApps).includes("Next.js"), true);
assert.equal(stackBadge(nestedApps), "supported");

const nestedFiles = loadFixtureDir("fixtures/data-flow/nested-next");
const nestedIndex = indexRepo(nestedFiles);
assert.equal(nestedIndex.frameworkOk, true, "nested Next should index");
assert.ok(
  nestedIndex.symbols.some((s) => s.kind === "page" && s.route === "/checkout"),
  "nested checkout page",
);
assert.ok(
  nestedIndex.symbols.some((s) => s.kind === "api" && s.route?.includes("orders")),
  "nested orders API",
);
const nestedPathSet = new Set(nestedFiles.map((f) => f.path));
assert.equal(
  nearestPackageRoot("apps/web/components/Cart.tsx", nestedPathSet),
  "apps/web",
);
assert.equal(
  resolveImportPath("apps/web/app/checkout/page.tsx", "@/components/Cart", nestedPathSet),
  "apps/web/components/Cart.tsx",
);
assert.ok(
  nestedIndex.edges.some((e) => e.certainty === "confirmed" && e.label === "imports"),
  "nested @/ import edge",
);
const nestedScan = buildFrontendArchitecture({
  files: nestedFiles,
  fullName: "fixture/nested-next",
  ref: "main",
  truncated: false,
});
assert.ok(nestedScan.stats.pages >= 2, "nested Next pages in architecture");

const fastapiFiles = loadFixtureDir("fixtures/data-flow/fastapi-app");
const fastapiIndex = indexRepo(fastapiFiles);
assert.equal(fastapiIndex.frameworkOk, true, "FastAPI should index");
assert.ok(
  fastapiIndex.symbols.some((s) => s.route === "/health"),
  "FastAPI /health",
);
assert.ok(
  fastapiIndex.symbols.some((s) => s.route === "/items/{item_id}"),
  "FastAPI prefixed router",
);
const fastapiScan = buildFrontendArchitecture({
  files: fastapiFiles,
  fullName: "fixture/fastapi-app",
  ref: "main",
  truncated: false,
});
assert.ok(fastapiScan.stats.pages === 0, "FastAPI has no frontend pages");
assert.ok(fastapiScan.stats.apis >= 2, "FastAPI APIs appear in architecture");

const djangoFiles = loadFixtureDir("fixtures/data-flow/django-app");
const djangoApps = refineAppsFromManifests(djangoFiles, inferAppsFromPaths(djangoFiles.map((f) => f.path)));
assert.ok(djangoApps.some((a) => a.kind === "django"));
const djangoIndex = indexRepo(djangoFiles);
assert.equal(djangoIndex.frameworkOk, false, "Django is listed, not indexed");
assert.match(djangoIndex.warnings.join(" "), /Django/i);

const viteFiles = loadFixtureDir("fixtures/data-flow/vite-app");
const viteIndex = indexRepo(viteFiles);
assert.equal(viteIndex.frameworkOk, true, "Vite/React should index");
assert.ok(viteIndex.symbols.some((s) => s.kind === "page" && s.route === "/login"));

const expressFiles = loadFixtureDir("fixtures/data-flow/express-app");
const expressIndex = indexRepo(expressFiles);
assert.equal(expressIndex.frameworkOk, true, "Express should index");
assert.ok(expressIndex.symbols.some((s) => s.route === "/health"));

const goFiles = loadFixtureDir("fixtures/data-flow/go-app");
const goIndex = indexRepo(goFiles);
assert.equal(goIndex.frameworkOk, true, "Go should index");
assert.ok(goIndex.symbols.some((s) => s.route === "/orders"));
assert.ok(goIndex.symbols.some((s) => s.route === "/health"));

console.log("frontend-arch multi-stack smoke passed");
