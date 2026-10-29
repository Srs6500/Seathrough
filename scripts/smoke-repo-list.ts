import assert from "node:assert/strict";
import {
  stackFromLanguage,
  stackFromPackageJson,
} from "../src/lib/bug-analyzer/detectStack";

assert.deepEqual(stackFromLanguage(null), {
  stackLabel: "Unknown stack",
  badge: "later",
});
assert.deepEqual(stackFromLanguage(""), {
  stackLabel: "Unknown stack",
  badge: "later",
});
assert.deepEqual(stackFromLanguage("TypeScript"), {
  stackLabel: "TypeScript",
  badge: "supported",
});
assert.deepEqual(stackFromLanguage("Python"), {
  stackLabel: "Python",
  badge: "later",
});
assert.equal(stackFromLanguage("Go").stackLabel, "Go");

const next = stackFromPackageJson(
  JSON.stringify({
    dependencies: { next: "15.0.0", react: "19.0.0", typescript: "5.0.0" },
  }),
);
assert.deepEqual(next, {
  stackLabel: "Next.js · TypeScript",
  badge: "supported",
});

const vite = stackFromPackageJson(
  JSON.stringify({
    devDependencies: { vite: "6.0.0", "@vitejs/plugin-react": "4.0.0" },
  }),
);
assert.equal(vite?.stackLabel, "Vite · React");

const empty = stackFromPackageJson("{not json");
assert.equal(empty, null);

console.log("smoke-repo-list: ok");
