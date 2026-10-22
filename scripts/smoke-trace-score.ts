/**
 * Offline smoke: scene path sampling + trace stroke scoring.
 */
import assert from "node:assert/strict";
import {
  sampleSceneObject,
  sampleSceneTarget,
} from "../src/lib/voice-tutor/scenePaths";
import {
  resamplePath,
  scoreTraceStroke,
} from "../src/lib/voice-tutor/traceScore";
import { functionsVoicePlan } from "../src/lib/voice-tutor/brain";
import type { VisualScene } from "../src/lib/voice-tutor/schemas";

function main() {
  const circle = sampleSceneObject({
    id: "c",
    type: "circle",
    params: { cx: 0, cy: 0, r: 3 },
  });
  assert.ok(circle.length > 20);
  // Roughly centered in viewBox.
  const mid = circle[Math.floor(circle.length / 2)]!;
  assert.ok(mid.x > 100 && mid.x < 300);

  const line = sampleSceneObject({
    id: "l",
    type: "line",
    params: { x1: 0, y1: -4, x2: 0, y2: 4 },
  });
  assert.ok(line.length > 10);

  const target = resamplePath(circle, 48);
  // Perfect-ish follow: same path.
  const perfect = scoreTraceStroke(circle, target);
  assert.equal(perfect.passed, true);
  assert.ok(perfect.coverage > 0.9);

  // Far-away scribble should fail.
  const bad = scoreTraceStroke(
    [
      { x: 10, y: 10 },
      { x: 20, y: 40 },
      { x: 30, y: 80 },
      { x: 40, y: 120 },
      { x: 50, y: 160 },
    ],
    target,
  );
  assert.equal(bad.passed, false);

  // Functions plan should include a trace beat after Phase 3 wiring.
  const plan = functionsVoicePlan();
  const traceBeat = plan.beats.find((b) => b.expectTrace);
  assert.ok(traceBeat, "functions plan should pause for tracing");
  assert.ok(traceBeat!.draw?.kind === "svg_graph");
  const scene = traceBeat!.draw!.spec?.scene as VisualScene;
  assert.ok(scene?.traceTask?.targetId || scene?.objects?.length);
  const samples = sampleSceneTarget(
    scene,
    scene.traceTask?.targetId || scene.objects[0]!.id,
  );
  assert.ok(samples.length > 5);

  const reconstruct = plan.beats.find((b) => b.traceMode === "reconstruct");
  assert.ok(reconstruct, "practice reconstruct beat should exist");

  console.log("smoke-trace-score: ok");
}

main();
