import assert from "node:assert/strict";
import { scanComponentCards } from "../src/lib/data-flow/componentScan";

const cards = scanComponentCards([
  {
    path: "src/components/LoginForm.tsx",
    size: 200,
    content: `
      export function LoginForm() {
        return (
          <form onSubmit={handleSubmit}>
            <input type="email" />
            <input type="password" placeholder="Password" />
            <button>Sign in</button>
          </form>
        );
      }
    `,
  },
  {
    path: "src/components/SearchBar.tsx",
    size: 180,
    content: `
      export function SearchBar() {
        return <input type="search" placeholder="Search repositories" />;
      }
    `,
  },
  {
    path: "src/lib/math.ts",
    size: 40,
    content: "export const add = (a: number, b: number) => a + b;",
  },
]);

const kinds = new Set(cards.map((c) => c.kind));
assert.ok(kinds.has("login"), "expected login card");
assert.ok(kinds.has("search"), "expected search card");
assert.equal(scanComponentCards([]).length, 0);

console.log("smoke-data-flow-scan: ok", {
  kinds: [...kinds],
  titles: cards.map((c) => c.title),
});
