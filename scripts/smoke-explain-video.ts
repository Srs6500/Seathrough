import assert from "node:assert/strict";
import {
  coercePlan,
  FILM_SECONDS_MAX,
  INCOMPLETE_PLAN,
  planDuration,
  planSchema,
  retimeToVoice,
  sceneIndexAt,
  sceneStarts,
  SPEAK_MAX,
  TARGET_SCENES,
  TOPIC_MAX,
  trimToTargetScenes,
  VOICED_SECONDS_MAX,
} from "../src/lib/explain-video/film";
import { extractScenes, LOOP_COUNTER, prepareScene } from "../src/lib/explain-video/sceneCode";

// ---------- plans ----------

const plan = coercePlan({
  title: "How a vaccine trains the body",
  look: "riso",
  angle: "Follow one harmless decoy from the needle to a memory cell.",
  scenes: [
    { title: "A decoy arrives", seconds: 6, see: "A syringe drops a spiky decoy into a pink field of cells.", say: "A vaccine carries a harmless copy of a germ's shape." },
    { title: "Cells take a look", seconds: 7, see: "Round immune cells drift to the decoy and trace its spikes.", say: "Immune cells study that shape." },
    { title: "Memory stays", seconds: 6.5, see: "Most cells fade; three memory cells glow and stay.", say: "Some cells remember it for years." },
  ],
});
assert.equal(plan.look, "riso");
assert.equal(plan.scenes.length, 3);
assert.equal(planDuration(plan), 19.5);
assert.equal(sceneIndexAt(plan, 0), 0);
assert.equal(sceneIndexAt(plan, 6.01), 1);
assert.equal(sceneIndexAt(plan, 12.99), 1);
assert.equal(sceneIndexAt(plan, 13), 2);
assert.equal(sceneIndexAt(plan, 999), 2);

const messy = coercePlan({
  plan: {
    title: "Why the sky is blue",
    style: "Blueprint chalk",
    scenes: [
      { name: "Sunlight", duration: "40", visual: "A white beam from the sun splits into colours.", caption: "Sunlight holds every colour." },
      { heading: "Air", dur: 1, description: "Tiny air molecules as dots; blue waves bounce off them.", text: "Short blue waves scatter off air." },
      { title: "Your eye", seconds: 8, see: "A stick figure looks up; blue arrows arrive from everywhere." },
      { title: "", see: "dropped: no title" },
      "not a scene",
    ],
  },
});
assert.equal(messy.look, "blueprint");
assert.equal(messy.scenes.length, 3);
assert.equal(messy.scenes[0]!.seconds, 10);
assert.equal(messy.scenes[1]!.seconds, 3);
assert.equal(messy.scenes[2]!.say, "Your eye", "say falls back to the title");
assert.equal(messy.angle, "Sunlight holds every colour.", "angle falls back to the first caption");

const long = coercePlan({
  title: "Long",
  look: "pencil",
  angle: "A long film.",
  scenes: Array.from({ length: 9 }, (_, k) => ({ title: `Scene ${k + 1}`, seconds: 10, see: "Something moves.", say: "Something happens." })),
});
assert.equal(long.scenes.length, 7, "at most 7 scenes");
assert.equal(trimToTargetScenes(long).scenes.length, TARGET_SCENES, "outline keeps five scenes");
assert.ok(planDuration(long) <= FILM_SECONDS_MAX, `film fits in ${FILM_SECONDS_MAX}s`);
assert.equal(TOPIC_MAX, 6000);
assert.ok(long.scenes.every((scene) => scene.seconds >= 3));

assert.equal(coercePlan({ title: "x", look: "oil painting", scenes: plan.scenes }).look, "ink", "unknown look falls back to ink");

assert.throws(() => coercePlan({ title: "Empty", scenes: [] }), { message: INCOMPLETE_PLAN });
assert.throws(() => coercePlan({ scenes: [{ title: "One", see: "one" }, { title: "Two", see: "two" }] }), { message: INCOMPLETE_PLAN });
assert.throws(() => coercePlan(null), { message: INCOMPLETE_PLAN });

for (const [style, look] of [
  ["sky", "sky"],
  ["Chalkboard lesson", "chalkboard"],
  ["deep space navy", "blueprint"],
  ["soft pastel watercolour", "pastel"],
  ["Blueprint chalk", "blueprint"],
] as const) {
  assert.equal(coercePlan({ title: "x", style, scenes: plan.scenes }).look, look, `"${style}" maps to ${look}`);
}

// ---------- narration ----------

assert.equal(plan.scenes[0]!.speak, plan.scenes[0]!.say, "narration falls back to the caption");
assert.equal(messy.scenes[2]!.speak, "Your eye", "narration falls back to the title when there is no caption");
const voiced = coercePlan({
  title: "Voiced",
  scenes: plan.scenes.map((scene, index) => ({
    ...scene,
    speak: index === 0 ? `A **vaccine** ${"is a harmless copy ".repeat(30)}` : undefined,
    voiceover: index === 1 ? "Immune cells gather round and learn its shape." : undefined,
  })),
});
assert.ok(voiced.scenes[0]!.speak.length <= SPEAK_MAX && voiced.scenes[0]!.speak.endsWith("…"), "long narration is clipped");
assert.ok(!voiced.scenes[0]!.speak.includes("*"), "markdown is stripped from narration");
assert.equal(voiced.scenes[1]!.speak, "Immune cells gather round and learn its shape.", "voiceover alias");

const retimed = retimeToVoice(plan, [4.2, null, 60, 0.5].slice(0, 3));
assert.equal(retimed.scenes[0]!.seconds, 5.3, "scene fits lead-in, line and a beat");
assert.equal(retimed.scenes[1]!.seconds, plan.scenes[1]!.seconds, "unvoiced scene keeps its planned length");
assert.equal(retimed.scenes[2]!.seconds, VOICED_SECONDS_MAX, "a very long line is capped");
assert.equal(retimeToVoice(plan, [0.5, Number.NaN, -1]).scenes[0]!.seconds, 3, "a short line still gets the minimum scene");
assert.equal(retimeToVoice(plan, [0.5, Number.NaN, -1]).scenes[1]!.seconds, plan.scenes[1]!.seconds, "NaN is ignored");
assert.ok(planSchema.safeParse(retimed).success, "a retimed plan still passes the API schema");
assert.deepEqual(sceneStarts(retimed), [0, 5.3, 5.3 + plan.scenes[1]!.seconds]);

// ---------- scene code ----------

const reply = [
  "Here are the scenes:",
  "```javascript",
  "function scene1(c, tau, i) {",
  "  paper(c);",
  "  const s = '}'; const t = `${'{'}`; // braces inside strings must not end the function",
  "  for (let k = 0; k < 3; k++) seedDot(c, 400 + k * 100, 400, 9);",
  "  while (false) {}",
  "}",
  "function helperOutside() { return 1; }",
  "const scene2 = (c, tau, i) => {",
  "  paper(c);",
  "  handText(c, 'hi', 960, 400);",
  "};",
  "function scene3(c, tau, i) {",
  "  paper(c);",
  "  fetch('https://example.com');",
  "}",
  "function scene4(c, tau, i) {",
  "  paper(c)",
  "  if (tau > 1 {",
  "}",
  "```",
].join("\n");

const sources = extractScenes(reply, 5);
assert.equal(sources.length, 5);
assert.ok(sources[0]!.startsWith("function scene1"), "scene1 extracted");
assert.ok(sources[0]!.trimEnd().endsWith("}"), "scene1 ends at its own closing brace");
assert.ok(!sources[0]!.includes("helperOutside"), "code after the scene function is not glued on");
assert.ok(sources[1]!.startsWith("const scene2"), "arrow scenes are extracted");
assert.equal(sources[4], null, "missing scene is null");

const one = prepareScene(sources[0]!, 1);
assert.ok(one.ok, one.ok ? "" : one.error);
if (one.ok) {
  const guards = one.code.split(`++${LOOP_COUNTER}`).length - 1;
  assert.equal(guards, 2, "both loops are guarded");
  assert.ok(one.code.includes("{if(++__loops"), "unbraced loop body is wrapped");
}

const two = prepareScene(sources[1]!, 2);
assert.ok(two.ok, two.ok ? "" : two.error);

const three = prepareScene(sources[2]!, 3);
assert.equal(three.ok, false);
if (!three.ok) assert.match(three.error, /fetch/);

const four = prepareScene(sources[3] ?? "function scene4(c, tau, i) { if (tau > 1 { }", 4);
assert.equal(four.ok, false);
if (!four.ok) assert.match(four.error, /Syntax error/);

const misnamed = prepareScene("function draw(c, tau, i) { paper(c); }", 2);
assert.equal(misnamed.ok, false);
if (!misnamed.ok) assert.match(misnamed.error, /function scene2/);

for (const [snippet, word] of [
  ["function scene1(c){ new Function('x')(); }", "Function"],
  ["function scene1(c){ window.parent.postMessage(1, '*'); }", "window.parent"],
  ["function scene1(c){ const w = self; w.postMessage(1); }", "postMessage"],
  ["function scene1(c){ document.cookie; }", "cookie"],
  ["function scene1(c){ setTimeout(() => 1, 5); }", "setTimeout"],
  ["function scene1(c){ import('x'); }", "import"],
  ["function scene1(c){ window.top.location = 'x'; }", "window.top"],
] as const) {
  const result = prepareScene(snippet, 1);
  assert.equal(result.ok, false, `${word} is refused`);
  if (!result.ok) assert.ok(result.error.includes(word), `${word} named in: ${result.error}`);
}

const legit = prepareScene(
  "function scene1(c, tau, i) { const top = 120, parent = { x: 1 }; paper(c); handText(c, 'ok', parent.x, top); }",
  1,
);
assert.ok(legit.ok, "local variables named top/parent are fine");

const shadow = prepareScene("function scene1(c, tau, i) { paper(c); const rng = rng(10); rng(); }", 1);
assert.equal(shadow.ok, false, "const rng = rng(...) is refused");
if (!shadow.ok) assert.match(shadow.error, /Rename/);
assert.ok(
  prepareScene("function scene1(c, tau, i) { const n = [1, 2].map(n => n * 2); paper(c); }", 1).ok,
  "a nested parameter with the same name is fine",
);

const undefinedName = prepareScene(
  "function scene1(c, tau, i) { paper(c); c.fillStyle = blue; c.fill(atriaPath); }",
  1,
);
assert.equal(undefinedName.ok, false, "undeclared names are caught before the browser");
if (!undefinedName.ok) {
  assert.match(undefinedName.error, /blue/);
  assert.match(undefinedName.error, /atriaPath/);
}
const leakedParam = prepareScene(
  [
    "function scene1(c, tau, i) {",
    "  const drawVein = (pts, color) => { c.strokeStyle = color; wob(c, pts, 1.5, 12); };",
    "  drawVein([[0, 0], [10, 10]], PAL.ink);",
    "  selfDraw(c, pts, tau, 3);",
    "}",
  ].join("\n"),
  1,
);
assert.equal(leakedParam.ok, false, "a helper's parameter is not visible outside the helper");
if (!leakedParam.ok) assert.match(leakedParam.error, /pts/);
const leakedBlock = prepareScene(
  "function scene1(c, tau, i) { if (tau > .5) { const r = 4; } c.lineWidth = r; }",
  1,
);
assert.equal(leakedBlock.ok, false, "a block-scoped const is not visible after its block");
assert.ok(
  prepareScene(
    [
      "const HEART = ellPts(960, 480, 200, 180);",
      "function scene1(c, tau, i) {",
      "  paper(c);",
      "  const { x, y: top = 3 } = { x: 1 }, [a, ...rest] = [1, 2];",
      "  if (tau > .5) { var late = 2; }",
      "  function helper(p) { return p + late + x + top + a + rest.length; }",
      "  const f = function named(n) { return n ? named(n - 1) : helper(1); };",
      "  try { f(2); } catch (err) { console.log(err); }",
      "  for (let k = 0; k < 3; k++) wob(c, HEART, k, 1);",
      "}",
    ].join("\n"),
    1,
  ).ok,
  "destructuring, hoisted var, named function expressions, catch params and top-level consts resolve",
);
const wellDefined = prepareScene(
  [
    "function scene1(c, tau, i) {",
    "  paper(c); const r = rng(4);",
    "  const pts = blob(CX, CY, 200, 160, 3);",
    "  const { x, y: yy } = { x: 1, y: 2 };",
    "  try { arrow(c, [x, yy], [W, H], { progress: sm(0, 1, tau, easeOut) }); } catch (err) { console.log(err); }",
    "  c.fillStyle = PAL.fills[0]; c.fill(curvePath(pts)); textBlock(c, 'hi', 10, 10, 400, {});",
    "  for (const [px, py] of pts) seedDot(c, px, py, r() * 4 + Math.PI);",
    "}",
  ].join("\n"),
  1,
);
assert.ok(wellDefined.ok, wellDefined.ok ? "" : wellDefined.error);

assert.equal(prepareScene("", 1).ok, false);
assert.equal(prepareScene(`function scene1(c){ ${"x;".repeat(13000)} }`, 1).ok, false, "oversized scene refused");

const zeroBased = extractScenes("function scene0(c,tau,i){paper(c);}\nfunction scene1(c,tau,i){paper(c);}", 2);
assert.ok(zeroBased[0]!.includes("scene1"), "zero-based numbering is shifted");
assert.ok(zeroBased[1]!.includes("scene2"));

console.log("smoke:explain-video ok");
