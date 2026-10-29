import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseGithubRepoInput } from "../src/lib/data-flow/parseRepoUrl";
import { sanitizeReturnTo } from "../src/lib/data-flow/installations";
import { featuresForFile } from "../src/lib/repo-scan/catalog";
import { runTreeSitterParse } from "../src/lib/repo-scan/runTreeSitter";
import { getMode } from "../src/modes/registry";

process.env.REPO_SCAN_TEST_PLANNER_LLM = "0";

const root = process.cwd();
const script = path.join(root, "backend", "tree-sitter.py");
const python = process.platform === "win32" ? "python" : "python3";

function runPython(stdin: string, extraArgs: string[] = []) {
  return spawnSync(python, ["-u", script, ...extraArgs], {
    cwd: root,
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
}

assert.equal(getMode("repo-scan")?.href, "/repo-scan");
assert.equal(getMode("repo-scan")?.enabled, false);
assert.equal(sanitizeReturnTo("/repo-scan"), "/repo-scan");
assert.equal(sanitizeReturnTo("/not-allowed"), "/data-flow");
assert.equal(sanitizeReturnTo(""), "/data-flow");
assert.equal(parseGithubRepoInput(""), null);
assert.equal(parseGithubRepoInput("   "), null);
assert.equal(parseGithubRepoInput("not-a-repo"), null);
assert.deepEqual(parseGithubRepoInput("vercel/next.js"), {
  owner: "vercel",
  repo: "next.js",
  fullName: "vercel/next.js",
  ref: undefined,
});

const efficiency = spawnSync(
  python,
  ["-u", path.join(root, "backend", "label_efficiency.py"), "--self-test"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  },
);
assert.equal(efficiency.status, 0, efficiency.stderr || efficiency.stdout);

const authGenSelf = spawnSync(
  python,
  ["-u", path.join(root, "backend", "auth_test_gen.py"), "--self-test"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  },
);
assert.equal(authGenSelf.status, 0, authGenSelf.stderr || authGenSelf.stdout);
const playwrightSelf = spawnSync(
  python,
  ["-u", path.join(root, "backend", "playwright_worker.py"), "--self-test"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  },
);
assert.equal(playwrightSelf.status, 0, playwrightSelf.stderr || playwrightSelf.stdout);

for (const moduleName of [
  "test_spec.py",
  "spec_compiler.py",
  "test_templates.py",
  "llm_test_spec.py",
  "repo_checks.py",
]) {
  const extraSelf = spawnSync(
    python,
    ["-u", path.join(root, "backend", moduleName), "--self-test"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    },
  );
  assert.equal(
    extraSelf.status,
    0,
    extraSelf.stderr || extraSelf.stdout || moduleName,
  );
}

const testingSelf = spawnSync(
  python,
  ["-u", path.join(root, "backend", "feature_testing.py"), "--self-test"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  },
);
assert.equal(testingSelf.status, 0, testingSelf.stderr || testingSelf.stdout);
const testingSelfJson = JSON.parse(testingSelf.stdout) as {
  ok?: boolean;
  selfTest?: boolean;
};
assert.equal(testingSelfJson.ok, true);
assert.equal(testingSelfJson.selfTest, true);

const runtimeBlocked = spawnSync(
  "node",
  [path.join(root, "scripts", "run-feature-runtime.mjs")],
  {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      test: {
        name: "Login page loads",
        type: "browser",
        assertion: "Login form is visible",
      },
      feature: { entry_points: ["/login"] },
      baseUrl: "",
    }),
  },
);
assert.equal(runtimeBlocked.status, 0, runtimeBlocked.stderr || runtimeBlocked.stdout);
const runtimeBlockedJson = JSON.parse(runtimeBlocked.stdout) as {
  status?: string;
};
assert.equal(runtimeBlockedJson.status, "blocked");

const runtimeInvalid = spawnSync(
  "node",
  [path.join(root, "scripts", "run-feature-runtime.mjs")],
  {
    cwd: root,
    encoding: "utf8",
    input: "{not json",
  },
);
assert.equal(runtimeInvalid.status, 0, runtimeInvalid.stderr || runtimeInvalid.stdout);
assert.equal(
  (JSON.parse(runtimeInvalid.stdout) as { status?: string }).status,
  "blocked",
);

const catalogSelf = spawnSync(
  python,
  ["-u", path.join(root, "backend", "feature_catalog.py"), "--self-test"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  },
);
assert.equal(catalogSelf.status, 0, catalogSelf.stderr || catalogSelf.stdout);
const catalogSelfJson = JSON.parse(catalogSelf.stdout) as {
  ok?: boolean;
  selfTest?: boolean;
};
assert.equal(catalogSelfJson.ok, true);
assert.equal(catalogSelfJson.selfTest, true);

const labeling = spawnSync(
  python,
  ["-u", path.join(root, "backend", "cluster_label.py"), "--self-test"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  },
);
assert.equal(labeling.status, 0, labeling.stderr || labeling.stdout);
const labelingJson = JSON.parse(labeling.stdout) as {
  ok?: boolean;
  selfTest?: boolean;
};
assert.equal(labelingJson.ok, true);
assert.equal(labelingJson.selfTest, true);

const discovery = spawnSync(
  python,
  ["-u", path.join(root, "backend", "feature_discovery.py"), "--self-test"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  },
);
assert.equal(discovery.status, 0, discovery.stderr || discovery.stdout);
const discoveryJson = JSON.parse(discovery.stdout) as {
  ok?: boolean;
  selfTest?: boolean;
};
assert.equal(discoveryJson.ok, true);
assert.equal(discoveryJson.selfTest, true);

const self = runPython("", ["--self-test"]);
assert.equal(self.status, 0, self.stderr || self.stdout);
const selfJson = JSON.parse(self.stdout) as { ok?: boolean; selfTest?: boolean };
assert.equal(selfJson.ok, true);
assert.equal(selfJson.selfTest, true);

const emptyStdin = runPython("");
assert.notEqual(emptyStdin.status, 0);
assert.match(emptyStdin.stdout, /files array/i);

const invalidJson = runPython("{not json");
assert.notEqual(invalidJson.status, 0);
assert.match(invalidJson.stdout, /valid JSON/i);

const missingFiles = runPython(JSON.stringify({ fullName: "a/b" }));
assert.notEqual(missingFiles.status, 0);
assert.match(missingFiles.stdout, /files array/i);

async function main() {
  const empty = await runTreeSitterParse({
    fullName: "owner/empty",
    ref: "main",
    files: [],
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.fileCount, 0);
  assert.equal(empty.parsedCount, 0);
  assert.deepEqual(empty.graph, { nodes: [], edges: [] });
  assert.deepEqual(empty.clusters, []);
  assert.deepEqual(empty.catalog?.features, []);
  assert.equal(empty.labeling?.llm_required?.parse, false);
  assert.equal(empty.labeling?.llm_calls, 0);
  assert.deepEqual(featuresForFile(empty.catalog, "lib/auth.ts").primary, []);

  const pythonSrc = readFileSync(
    path.join(root, "fixtures/data-flow/fastapi-app/main.py"),
    "utf8",
  );
  const tsxSrc = readFileSync(
    path.join(root, "fixtures/data-flow/vite-app/src/pages/Home.tsx"),
    "utf8",
  );
  const parsed = await runTreeSitterParse({
    fullName: "fixtures/repo-scan",
    ref: "main",
    files: [
      { path: "main.py", content: pythonSrc },
      { path: "src/pages/Home.tsx", content: tsxSrc },
      { path: "README.md", content: "# skip me\n" },
      { path: "broken.py", content: "def (\n" },
      { path: "empty.py", content: "" },
    ],
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.fileCount, 5);
  assert.equal(parsed.parsedCount, 4);
  assert.equal(parsed.skippedCount, 1);
  assert.ok(parsed.languages.python >= 2);
  assert.ok(parsed.languages.tsx >= 1);

  const py = parsed.files.find((file) => file.path === "main.py");
  assert.ok(py);
  assert.equal(py.language, "python");
  assert.equal(py.hasError, false);
  assert.ok(py.sexp.includes("function_definition"));
  assert.ok(py.symbols.some((symbol) => symbol.name === "health"));

  const tsx = parsed.files.find((file) => file.path === "src/pages/Home.tsx");
  assert.ok(tsx);
  assert.equal(tsx.language, "tsx");
  assert.equal(tsx.hasError, false);
  assert.ok(tsx.symbols.some((symbol) => symbol.name === "Home"));

  const skipped = parsed.files.find((file) => file.path === "README.md");
  assert.ok(skipped?.skipped);

  const broken = parsed.files.find((file) => file.path === "broken.py");
  assert.ok(broken?.hasError);
  assert.ok((broken?.errorCount ?? 0) >= 1);
  assert.equal(parsed.errorFileCount, 1);
  assert.ok(
    parsed.parseIssues?.some((issue) => issue.path === "broken.py"),
    "broken.py should appear in parseIssues",
  );

  const blank = parsed.files.find((file) => file.path === "empty.py");
  assert.ok(blank);
  assert.equal(blank.skipped, false);
  assert.equal(blank.language, "python");

  const graphDir = path.join(root, "fixtures/repo-scan/file-graph");
  const graphFiles: Array<{ path: string; content: string }> = [];
  function walkGraph(rel: string) {
    const abs = path.join(graphDir, rel);
    for (const name of readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = path.join(graphDir, childRel);
      if (statSync(childAbs).isDirectory()) {
        walkGraph(childRel);
        continue;
      }
      graphFiles.push({
        path: childRel.replace(/\\/g, "/"),
        content: readFileSync(childAbs, "utf8"),
      });
    }
  }
  walkGraph("");

  const graphParse = await runTreeSitterParse({
    fullName: "fixtures/repo-scan/file-graph",
    ref: "main",
    files: graphFiles,
  });
  assert.ok(graphParse.graph, "expected file relationship graph");
  const nodeSet = new Set(
    graphParse.graph.nodes.map((node) => `${node.id}:${node.role}`),
  );
  for (const id of [
    "app/login/page.tsx:page",
    "components/LoginForm.tsx:component",
    "lib/auth.ts:service",
    "app/dashboard/page.tsx:page",
    "components/Stats.tsx:component",
    "lib/db.ts:service",
  ]) {
    assert.ok(nodeSet.has(id), `missing node ${id}`);
  }
  const edgeSet = new Set(
    graphParse.graph.edges.map(
      (edge) => `${edge.source}->${edge.target}:${edge.type}`,
    ),
  );
  assert.ok(
    edgeSet.has("app/login/page.tsx->components/LoginForm.tsx:renders"),
  );
  assert.ok(edgeSet.has("components/LoginForm.tsx->lib/auth.ts:calls"));
  assert.ok(
    edgeSet.has("app/dashboard/page.tsx->components/Stats.tsx:renders"),
  );
  assert.ok(edgeSet.has("components/Stats.tsx->lib/db.ts:calls"));
  assert.ok(
    !edgeSet.has("app/login/page.tsx->components/Stats.tsx:renders"),
    "unused import must not become a renders edge",
  );
  const clusterGroups = new Set(
    (graphParse.clusters ?? []).map((cluster) =>
      [...cluster.files].sort().join("|"),
    ),
  );
  assert.ok(
    clusterGroups.has(
      "app/login/page.tsx|components/LoginForm.tsx|lib/auth.ts",
    ),
    "login feature should cluster together",
  );
  assert.ok(
    clusterGroups.has(
      "app/dashboard/page.tsx|components/Stats.tsx|lib/db.ts",
    ),
    "dashboard feature should cluster together",
  );
  const loginCluster = graphParse.clusters?.find((cluster) =>
    cluster.files.includes("app/login/page.tsx"),
  );
  assert.ok(loginCluster?.name, "login cluster should have a user-facing name");
  assert.ok(
    !loginCluster?.summary?.files.some((file) => "content" in file),
    "cluster summary must not include file contents",
  );
  const graphAuth = graphParse.catalog?.features.find(
    (item) =>
      item.feature_id === "authentication" ||
      item.primary_files.includes("lib/auth.ts"),
  );
  assert.ok(graphAuth, "graph fixture should store an auth feature");
  assert.equal(graphAuth?.verification_status, "inconclusive");
  assert.equal(
    graphAuth?.verification?.tests.some(
      (item) => item.name === "Login entry exists" && item.status === "pass",
    ),
    true,
  );
  assert.equal(
    graphAuth?.verification?.tests.some(
      (item) => item.name === "Login page renders" && item.status === "blocked",
    ),
    true,
  );
  assert.ok(graphAuth?.verification?.generated_test?.contents);

  const featureDir = path.join(root, "fixtures/repo-scan/feature-folders");
  const featureFiles: Array<{ path: string; content: string }> = [];
  function walkFeature(rel: string) {
    const abs = path.join(featureDir, rel);
    for (const name of readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = path.join(featureDir, childRel);
      if (statSync(childAbs).isDirectory()) {
        walkFeature(childRel);
        continue;
      }
      featureFiles.push({
        path: childRel.replace(/\\/g, "/"),
        content: readFileSync(childAbs, "utf8"),
      });
    }
  }
  walkFeature("");

  const featureParse = await runTreeSitterParse({
    fullName: "fixtures/repo-scan/feature-folders",
    ref: "main",
    files: featureFiles,
  });
  const loginNode = featureParse.graph?.nodes.find(
    (node) => node.id === "web/src/features/auth/LoginPage.tsx",
  );
  assert.equal(loginNode?.role, "page", "named feature page should be a page");
  const byLabel = new Map(
    (featureParse.clusters ?? [])
      .filter((cluster) => cluster.label)
      .map((cluster) => [cluster.label, new Set(cluster.files)]),
  );
  const auth = byLabel.get("auth");
  const terminal = byLabel.get("terminal");
  assert.ok(auth?.has("web/src/features/auth/LoginPage.tsx"));
  assert.ok(auth?.has("web/src/features/auth/AuthBackground.tsx"));
  assert.ok(terminal?.has("web/src/features/terminal/TradePage.tsx"));
  assert.ok(terminal?.has("web/src/features/terminal/OrderTicket.tsx"));
  assert.ok(!auth?.has("web/src/components/ui/button.tsx"));
  assert.ok(!terminal?.has("web/src/components/ui/button.tsx"));
  assert.ok(!auth?.has("web/src/app/router.tsx"));
  assert.ok(!terminal?.has("web/src/app/App.tsx"));

  const seededDir = path.join(root, "fixtures/repo-scan/route-seeded");
  const seededFiles: Array<{ path: string; content: string }> = [];
  function walkSeeded(rel: string) {
    const abs = path.join(seededDir, rel);
    for (const name of readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = path.join(seededDir, childRel);
      if (statSync(childAbs).isDirectory()) {
        walkSeeded(childRel);
        continue;
      }
      seededFiles.push({
        path: childRel.replace(/\\/g, "/"),
        content: readFileSync(childAbs, "utf8"),
      });
    }
  }
  walkSeeded("");
  const seededParse = await runTreeSitterParse({
    fullName: "fixtures/repo-scan/route-seeded",
    ref: "main",
    files: seededFiles,
  });
  const seededByLabel = new Map(
    (seededParse.clusters ?? [])
      .filter((cluster) => cluster.label)
      .map((cluster) => [cluster.label, cluster]),
  );
  const seededAuth = seededByLabel.get("auth");
  const seededDashboard = seededByLabel.get("dashboard");
  const seededPayments = seededByLabel.get("payments");
  assert.ok(
    seededAuth?.entries?.includes("app/login/page.tsx") &&
      seededAuth.entries.includes("app/signup/page.tsx"),
    "login and signup should be one authentication feature",
  );
  assert.ok(seededAuth?.files.includes("lib/auth.ts"));
  assert.ok(!seededAuth?.files.includes("lib/stripe.ts"));
  assert.ok(!seededAuth?.files.includes("components/Button.tsx"));
  assert.ok(!seededAuth?.files.includes("lib/database.ts"));
  assert.ok(seededDashboard?.files.includes("components/Navbar.tsx"));
  assert.ok(seededPayments?.files.includes("lib/stripe.ts"));
  const seededShared = new Set([
    ...(seededAuth?.shared_files ?? []),
    ...(seededPayments?.shared_files ?? []),
    ...(seededDashboard?.shared_files ?? []),
  ]);
  assert.ok(seededShared.has("components/Button.tsx"));
  assert.ok(seededShared.has("lib/database.ts"));
  const storedAuth = seededParse.catalog?.features.find(
    (item) => item.feature_id === "authentication",
  );
  assert.ok(storedAuth, "catalog should store authentication");
  assert.deepEqual(storedAuth?.entry_points, ["/login", "/signup"]);
  assert.ok(storedAuth?.primary_files.includes("lib/auth.ts"));
  assert.ok(storedAuth?.shared_dependencies.includes("lib/database.ts"));
  assert.equal(storedAuth?.verification_status, "inconclusive");
  const storedTests = Object.fromEntries(
    (storedAuth?.verification?.tests ?? []).map((item) => [item.name, item]),
  );
  assert.equal(storedTests["Login entry exists"]?.status, "pass");
  assert.equal(storedTests["Auth service exists"]?.status, "pass");
  assert.equal(storedTests["Login page renders"]?.status, "blocked");
  assert.equal(storedTests["Private route access protected"]?.status, "inconclusive");
  assert.equal(storedAuth?.verification?.generated_test?.path, "tests/seethrough-auth.spec.ts");
  assert.ok(
    (storedAuth?.verification?.generated_test?.specs?.length ?? 0) > 0,
    "auth Playwright must be compiled from restricted specs",
  );
  const storedDashboard = seededParse.catalog?.features.find(
    (item) => item.feature_id === "dashboard",
  );
  assert.match(
    storedDashboard?.verification?.generated_test?.path ?? "",
    /seethrough-dashboard\.spec\.ts/,
  );
  assert.match(
    storedAuth?.verification?.generated_test?.contents ?? "",
    /Login page renders/,
  );
  assert.equal(
    /invalid@example\.test/.test(
      storedAuth?.verification?.generated_test?.contents ?? "",
    ),
    false,
    "route-seeded login has no email field, so credential fills must not be invented",
  );
  const storedPayments = seededParse.catalog?.features.find(
    (item) => item.feature_id === "payments",
  );
  const paymentTests = Object.fromEntries(
    (storedPayments?.verification?.tests ?? []).map((item) => [item.name, item]),
  );
  assert.equal(paymentTests["Duplicate webhook handling"]?.status, "inconclusive");
  const authHit = featuresForFile(seededParse.catalog, "lib/auth.ts");
  assert.equal(authHit.primary[0]?.feature_id, "authentication");
  const dbHit = featuresForFile(seededParse.catalog, "lib/database.ts");
  assert.ok(dbHit.shared.some((item) => item.feature_id === "authentication"));
  assert.ok(dbHit.shared.some((item) => item.feature_id === "dashboard"));
  const sharedFiles = new Set(
    (featureParse.clusters ?? [])
      .filter((cluster) => cluster.source === "shared")
      .flatMap((cluster) => cluster.files),
  );
  assert.ok(sharedFiles.has("web/src/components/ui/button.tsx"));
  assert.ok(sharedFiles.has("web/src/shared/lib/AuthContext.tsx"));
  assert.ok(sharedFiles.has("web/src/app/router.tsx"));

  const authFormDir = path.join(root, "fixtures/repo-scan/auth-form");
  const authFormFiles: Array<{ path: string; content: string }> = [];
  function walkAuthForm(rel: string) {
    const abs = path.join(authFormDir, rel);
    for (const name of readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = path.join(authFormDir, childRel);
      if (statSync(childAbs).isDirectory()) {
        walkAuthForm(childRel);
        continue;
      }
      authFormFiles.push({
        path: childRel.replace(/\\/g, "/"),
        content: readFileSync(childAbs, "utf8"),
      });
    }
  }
  walkAuthForm("");
  const authFormParse = await runTreeSitterParse({
    fullName: "fixtures/repo-scan/auth-form",
    ref: "main",
    files: authFormFiles,
  });
  const formAuth = authFormParse.catalog?.features.find(
    (item) =>
      item.feature_id === "authentication" ||
      item.primary_files.includes("lib/auth.ts"),
  );
  const formSpec = formAuth?.verification?.generated_test?.contents ?? "";
  assert.match(formSpec, /input\[type=\\"email\\"\]/);
  assert.match(formSpec, /invalid@example\.test/);
  assert.match(formSpec, /\/api\/auth\/session/);
  assert.match(formSpec, /\/api\/stats/);
  assert.match(formSpec, /private-dashboard/);

  console.log("smoke-repo-scan: ok", {
    files: parsed.fileCount,
    parsed: parsed.parsedCount,
    skipped: parsed.skippedCount,
    languages: parsed.languages,
    graphNodes: graphParse.graph.nodes.length,
    graphEdges: graphParse.graph.edges.length,
    clusters: graphParse.clusters?.length ?? 0,
    featureClusters: featureParse.clusters?.map((cluster) => cluster.label),
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
