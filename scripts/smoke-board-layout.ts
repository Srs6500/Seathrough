import assert from "node:assert/strict";
import { layoutBoard } from "../src/lib/ai-tutor-v2/layout";
import type { BoardNodes } from "../src/lib/ai-tutor-v2/types";

const messy: BoardNodes = {
  eq: {
    id: "eq",
    type: "box",
    x: 200,
    y: 120,
    width: 420,
    height: 100,
    label: "2x + 5 = 17",
  },
  ask: {
    id: "ask",
    type: "text",
    x: 320,
    y: 230,
    text: "Solve for x",
    role: "label",
  },
  ans: {
    id: "ans",
    type: "box",
    x: 340,
    y: 210,
    width: 160,
    height: 80,
    label: "x = 6",
  },
};

const laid = layoutBoard(messy);
const eq = laid.eq!;
const ask = laid.ask!;
const ans = laid.ans!;
assert.equal(eq.type, "box");
assert.equal(ask.type, "text");
assert.equal(ans.type, "box");

if (eq.type === "box" && ans.type === "box") {
  const eqBottom = eq.y + eq.height;
  const ansTop = ans.y;
  assert.ok(ansTop >= eqBottom + 20, `answer should sit below equation: ${ansTop} vs ${eqBottom}`);
}

console.log("smoke-board-layout: ok", {
  eq: eq.type === "box" ? { x: eq.x, y: eq.y } : null,
  ask: ask.type === "text" ? { x: ask.x, y: ask.y } : null,
  ans: ans.type === "box" ? { x: ans.x, y: ans.y } : null,
});
