import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildAnalysisAndIndex } from "../src/lib/bug-analyzer/buildDataIndex";
import type { FeatureFlow } from "../src/lib/bug-analyzer/buildDataIndex";
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
      files.push({
        path: rel.replace(/\\/g, "/"),
        content,
        size: Buffer.byteLength(content),
      });
    }
  }
  walk(root, "");
  return files;
}

function source(path: string, content: string): RepoSourceFile {
  return { path, content, size: Buffer.byteLength(content) };
}

const NEXT_PKG = source(
  "package.json",
  JSON.stringify({
    name: "sample",
    dependencies: { next: "15.0.0", react: "19.0.0" },
  }),
);

function indexOf(files: RepoSourceFile[], truncated = false) {
  return buildAnalysisAndIndex({
    fullName: "acme/sample",
    ref: "main",
    scope: "repo",
    focusPath: null,
    files,
    truncated,
  }).index;
}

function names(features: FeatureFlow[]): string[] {
  return features.map((feature) => feature.name).sort();
}

const login = indexOf(
  loadFixture(join(process.cwd(), "fixtures/frontend-arch/broken-login")),
);
assert.deepEqual(names(login.features), ["Dashboard", "Login"]);
const loginFeature = login.features.find((feature) => feature.name === "Login");
assert.ok(loginFeature, "login card missing");
assert.ok(
  loginFeature.nodes.some((node) => node.kind === "api" && /login/.test(node.file || "")),
  "login card should include the login API",
);
assert.equal(
  login.features.some((feature) => feature.name === "Application"),
  false,
);

const expense = indexOf(loadFixture(join(process.cwd(), "fixtures/data-flow/expense")));
const checkout = expense.features.find((feature) => feature.name === "Checkout");
assert.ok(checkout, `expected Checkout, got ${names(expense.features).join(", ")}`);
assert.ok(
  checkout.nodes.some((node) => node.kind === "api" && /orders/.test(node.file || "")),
  "checkout card should include the orders API it fetches",
);

const authMerge = indexOf([
  NEXT_PKG,
  source(
    "app/login/page.tsx",
    `import { LoginForm } from "@/components/LoginForm";
export default function LoginPage() { return <LoginForm />; }`,
  ),
  source(
    "components/LoginForm.tsx",
    `export function LoginForm() { return <form><button>Sign in</button></form>; }`,
  ),
  source(
    "app/signup/page.tsx",
    `import { SignupForm } from "@/components/SignupForm";
export default function SignupPage() { return <SignupForm />; }`,
  ),
  source(
    "components/SignupForm.tsx",
    `export function SignupForm() { return <form><button>Create account</button></form>; }`,
  ),
  source(
    "app/api/session/route.ts",
    `export async function GET() { return Response.json({ ok: true }); }`,
  ),
]);
assert.equal(authMerge.features.length, 1, names(authMerge.features).join(", "));
assert.equal(authMerge.features[0]?.name, "Login & Signup");
assert.ok(
  authMerge.features[0]?.nodes.some((node) => /session/.test(node.file || "")),
  "auth card should absorb the session API",
);

const separate = indexOf([
  NEXT_PKG,
  source(
    "app/lessons/page.tsx",
    `export default function LessonsPage() { return <main>Lessons</main>; }`,
  ),
  source(
    "app/course-creator/page.tsx",
    `export default function CourseCreatorPage() { return <main>Creator</main>; }`,
  ),
]);
assert.deepEqual(names(separate.features), ["Course Creator", "Lessons"]);

const apiOnly = indexOf([
  NEXT_PKG,
  source(
    "app/api/webhooks/stripe/route.ts",
    `export async function POST() { return Response.json({ ok: true }); }`,
  ),
]);
assert.equal(apiOnly.features.length, 1);
assert.equal(apiOnly.features[0]?.name, "Stripe API");
assert.equal(apiOnly.features[0]?.nodes[0]?.kind, "api");
assert.equal(apiOnly.status, "indexed");

const empty = indexOf([]);
assert.deepEqual(empty.features, []);
assert.equal(empty.status, "partial");

const blank = indexOf([
  NEXT_PKG,
  source("app/blank/page.tsx", "   \n"),
  source("notes.txt", ""),
]);
assert.ok(
  blank.features.some((feature) => feature.name === "Blank"),
  `blank page should still be a card, got ${names(blank.features).join(", ")}`,
);

const truncated = indexOf(
  [
    NEXT_PKG,
    source(
      "app/settings/page.tsx",
      `export default function SettingsPage() { return <main>Settings</main>; }`,
    ),
  ],
  true,
);
assert.equal(truncated.status, "partial");
assert.equal(truncated.features.length, 1);
assert.equal(truncated.features[0]?.name, "Settings");

const fastapi = indexOf(
  loadFixture(join(process.cwd(), "fixtures/data-flow/fastapi-app")),
);
assert.ok(
  fastapi.features.some((feature) => /health/i.test(feature.name)),
  `expected a health API card, got ${names(fastapi.features).join(", ")}`,
);
assert.ok(
  fastapi.features.some((feature) => /items/i.test(feature.name)),
  `expected an items API card, got ${names(fastapi.features).join(", ")}`,
);
assert.equal(
  fastapi.features.some((feature) => feature.name === "Application"),
  false,
);

console.log("smoke-feature-cards: ok", {
  login: names(login.features),
  expense: names(expense.features),
  auth: names(authMerge.features),
  separate: names(separate.features),
  apiOnly: names(apiOnly.features),
  fastapi: names(fastapi.features),
});
