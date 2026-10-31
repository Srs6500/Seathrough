import assert from "node:assert/strict";
import { inspectSceneCode } from "../src/lib/scene-explain/inspectCode";
import { parseRepairedCode, parseScenePlan, parseSceneProgram } from "../src/lib/scene-explain/parseProgram";
import { buildSceneIframeSrc } from "../src/lib/scene-explain/iframeRuntime";
import {
  builtinSceneForPrompt,
  MATRIX_MULT_SCENE,
  OSMOSIS_SCENE,
} from "../src/lib/scene-explain/builtinScenes";
import { sceneSpeakRequestSchema } from "../src/lib/scene-explain/schemas";
import { groqModelOrReplacement } from "../src/lib/env";
import { getMode, listEnabledModes } from "../src/modes/registry";

// --- empty / invalid ---------------------------------------------------
{
  assert.equal(inspectSceneCode("").ok, false);
  assert.equal(inspectSceneCode("   ").ok, false);
  const fetchHit = inspectSceneCode("fetch('https://example.com')");
  assert.equal(fetchHit.ok, false);
  const evalHit = inspectSceneCode("eval('x')");
  assert.equal(evalHit.ok, false);
  const parentHit = inspectSceneCode("window.parent.location = '/'");
  assert.equal(parentHit.ok, false);
  const loaderHit = inspectSceneCode("new THREE.TextureLoader().load('x.png')");
  assert.equal(loaderHit.ok, false);
  assert.equal(
    inspectSceneCode("const m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1)); scene.add(m);").ok,
    true,
  );
}

// --- parse labeled agent output ----------------------------------------
{
  const program = parseSceneProgram(`
===JSON===
{"title":"Osmosis","maxReveal":4,"beats":[
  {"order":1,"narration":"Water meets a membrane.","reveal":1},
  {"order":2,"narration":"Solute pulls water across.","reveal":2}
]}
===CODE===
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshStandardMaterial({ color: 0x1b6ca8 }));
scene.add(ball);
__update = function(dt, time) { ball.position.x = Math.sin(time); };
`);
  assert.equal(program.title, "Osmosis");
  assert.equal(program.beats.length, 2);
  assert.ok(program.code.includes("SphereGeometry"));
  assert.equal(inspectSceneCode(program.code).ok, true);
}

{
  const fromJson = parseSceneProgram(
    JSON.stringify({
      title: "Orbit",
      maxReveal: 3,
      beats: [{ order: 1, narration: "A planet goes around a star.", reveal: 1 }],
      code: "scene.add(new THREE.Mesh(new THREE.SphereGeometry(1)));",
    }),
  );
  assert.equal(fromJson.title, "Orbit");
}

{
  const plan = parseScenePlan(
    JSON.stringify({
      title: "Deep orbit",
      maxReveal: 9,
      beats: Array.from({ length: 8 }, (_, i) => ({
        order: i + 1,
        narration: `Sentence one about stage ${i + 1}. Sentence two on mechanism. Sentence three on what comes next.`,
        reveal: i + 1,
      })),
      visualBrief:
        "Central star sphere emissive 0xffcc66. Planet mesh. 120 trail dots. Gravity arrow group. Velocity arrow. Reveal 1 star only; 2 add planet; 3 velocity; 4 gravity; 5 trail; 6 both arrows pulse; 7 periapsis highlight; 8–9 full system with labels-as-marker meshes. __update orbits planet and advances trail.",
    }),
  );
  assert.equal(plan.title, "Deep orbit");
  assert.equal(plan.beats.length, 8);
  assert.ok(plan.visualBrief.includes("trail"));
}

{
  assert.throws(() => parseSceneProgram(""));
  assert.throws(() => parseSceneProgram("{ not json"));
  assert.throws(() =>
    parseSceneProgram(
      JSON.stringify({ title: "X", beats: [{ order: 1, narration: "hi" }] }),
    ),
  );
}

{
  const repaired = parseRepairedCode(
    "===CODE===\nconst g = new THREE.Group();\nscene.add(g);\n",
    "Osmosis",
  );
  assert.ok(repaired.includes("Group"));
}

// --- iframe host wraps code safely -------------------------------------
{
  const html = buildSceneIframeSrc("scene.add(new THREE.Group());");
  assert.ok(html.includes("three.module.min.js"));
  assert.ok(html.includes("seethrough-scene"));
  assert.ok(html.includes("JSON.stringify") === false);
  assert.ok(html.includes("scene.add(new THREE.Group())"));
}

// --- mode is plugged in ------------------------------------------------
{
  const mode = getMode("scene-explain");
  assert.ok(mode);
  assert.equal(mode?.href, "/lessons?view=3d");
  assert.equal(mode?.enabled, false);
  assert.ok(!listEnabledModes("learning").some((m) => m.id === "scene-explain"));
}

// --- retired Groq models still resolve --------------------------------
{
  assert.equal(
    groqModelOrReplacement("llama-3.3-70b-versatile"),
    "openai/gpt-oss-120b",
  );
  assert.equal(groqModelOrReplacement(""), "openai/gpt-oss-120b");
  assert.equal(
    groqModelOrReplacement("qwen/qwen3.6-27b"),
    "qwen/qwen3.8-27b",
  );
}

// --- osmosis fallback is runnable -------------------------------------
{
  const osmosis = builtinSceneForPrompt("explain osmosis");
  assert.ok(osmosis);
  assert.equal(osmosis?.title, "Osmosis");
  assert.equal(inspectSceneCode(OSMOSIS_SCENE.code).ok, true);
  assert.equal(builtinSceneForPrompt(""), null);
}

{
  const mx = builtinSceneForPrompt("explain matrix multiplication");
  assert.ok(mx);
  assert.equal(mx?.title, "Matrix multiplication");
  assert.equal(inspectSceneCode(MATRIX_MULT_SCENE.code).ok, true);
  assert.ok(MATRIX_MULT_SCENE.code.includes("CanvasTexture"));
  assert.ok(MATRIX_MULT_SCENE.beats.some((b) => /19/.test(b.narration)));
}

// --- speak request contract -------------------------------------------
{
  assert.equal(sceneSpeakRequestSchema.safeParse({ text: "" }).success, false);
  assert.equal(sceneSpeakRequestSchema.safeParse({}).success, false);
  assert.equal(
    sceneSpeakRequestSchema.safeParse({ text: "Water crosses the membrane." }).success,
    true,
  );
  assert.equal(
    sceneSpeakRequestSchema.safeParse({ text: "x".repeat(901) }).success,
    false,
  );
}

console.log("scene-explain smoke checks passed");
