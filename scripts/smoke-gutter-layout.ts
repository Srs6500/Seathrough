/**
 * Offline smoke: diagram gutter collision packing.
 */
import assert from "node:assert/strict";
import { packGutterPlacements } from "../src/lib/voice-tutor/gutterLayout";

function main() {
  // Non-overlapping preferred tops stay put.
  const simple = packGutterPlacements(
    [
      { id: "a", triggerTop: 0, height: 100 },
      { id: "b", triggerTop: 200, height: 100 },
    ],
    { gap: 16 },
  );
  assert.equal(simple[0]!.top, 0);
  assert.equal(simple[1]!.top, 200);

  // Overlap nudges the later card down.
  const collide = packGutterPlacements(
    [
      { id: "a", triggerTop: 40, height: 200 },
      { id: "b", triggerTop: 80, height: 200 },
    ],
    { gap: 20 },
  );
  assert.equal(collide[0]!.top, 40);
  assert.equal(collide[1]!.top, 40 + 200 + 20);

  // Obstacles (e.g. tip chips) also block.
  const blocked = packGutterPlacements(
    [{ id: "d", triggerTop: 10, height: 100 }],
    {
      gap: 10,
      obstacles: [{ top: 0, height: 60 }],
    },
  );
  assert.equal(blocked[0]!.top, 70);

  // minTop floors placement.
  const floored = packGutterPlacements(
    [{ id: "d", triggerTop: -20, height: 80 }],
    { minTop: 12 },
  );
  assert.equal(floored[0]!.top, 12);

  console.log("smoke-gutter-layout: ok");
}

main();
