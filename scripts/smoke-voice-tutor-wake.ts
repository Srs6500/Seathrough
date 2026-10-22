/**
 * Offline smoke for wake-phrase matching.
 *
 *   npm run smoke:voice-tutor-wake
 */
import assert from "node:assert/strict";
import {
  matchesWakePhrase,
  normalizeWakeText,
} from "../src/lib/voice-tutor/wakeWord";

function main() {
  assert.equal(normalizeWakeText("Hey, See-Through!"), "hey see through");

  const a = matchesWakePhrase("hey seethrough");
  assert.equal(a.matched, true);
  assert.equal(a.remainder, "");

  const b = matchesWakePhrase("Hey See Through photosynthesis please");
  assert.equal(b.matched, true);
  assert.ok(b.remainder.includes("photosynthesis"));

  const c = matchesWakePhrase("okay tutor");
  assert.equal(c.matched, true);

  const d = matchesWakePhrase("I want to learn baking");
  assert.equal(d.matched, false);

  const e = matchesWakePhrase("um hey tutor what is gravity");
  assert.equal(e.matched, true);
  assert.ok(e.remainder.includes("gravity"));

  console.log("smoke-voice-tutor-wake: ok");
}

main();
