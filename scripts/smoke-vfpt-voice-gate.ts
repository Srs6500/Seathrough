/**
 * Offline smoke: Voice Tutor VFPt topic gate + score floor.
 * Never attach a field diagram for unrelated subjects.
 */
import assert from "node:assert/strict";
import {
  looksLikeVfptElectricTopic,
  pickVfptForVoiceTutor,
  VFPT_VOICE_MIN_SCORE,
} from "../src/lib/voice-tutor/vfptGate";
import { attachVoiceDiagrams } from "../src/lib/voice-tutor/attachDiagrams";
import type { VoiceLessonPlan } from "../src/lib/voice-tutor/sessionTypes";

function basePlan(topic: string, keyPoints: string[] = []): VoiceLessonPlan {
  return {
    label: topic,
    topic,
    objective: `Understand ${topic}`,
    beats: [
      {
        id: "b1",
        say: `Let's look at ${topic}.`,
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: topic,
          sourceText: `A short passage about ${topic} for the board.`,
          keyPoints,
          highlight: topic.slice(0, 24),
          pointer: "both",
          annotations: [],
        },
      },
      {
        id: "b2",
        say: "Quick check?",
        expectAnswer: true,
        rubricKeywords: [],
      },
    ],
  };
}

function main() {
  assert.equal(looksLikeVfptElectricTopic("electric dipole field lines"), true);
  assert.equal(looksLikeVfptElectricTopic("point charges attract"), true);
  assert.equal(looksLikeVfptElectricTopic("World War II causes"), false);
  assert.equal(looksLikeVfptElectricTopic("Java inheritance"), false);

  const physics = pickVfptForVoiceTutor(
    "electric dipole field lines and point charges",
  );
  // Corpus may be empty in CI clones — only assert shape when present.
  if (physics) {
    assert.ok(physics.score >= VFPT_VOICE_MIN_SCORE);
    assert.ok(physics.url.startsWith("/physics/vfpt/"));
    assert.ok(physics.diagram.filename.length > 0);
  }

  const wwii = pickVfptForVoiceTutor("causes of World War II");
  assert.equal(wwii, null);

  const javaPlan = attachVoiceDiagrams(
    basePlan("Java inheritance", [
      "subclass inherits fields",
      "override methods carefully",
      "prefer composition sometimes",
    ]),
  );
  const javaDraw = javaPlan.beats[0]?.draw;
  assert.ok(javaDraw);
  assert.equal(javaDraw!.kind, "tldraw_sketch");
  assert.notEqual(javaDraw!.kind, "vfpt_svg");

  const dipolePlan = attachVoiceDiagrams(
    basePlan("electric dipole", ["field lines leave +", "enter −"]),
  );
  const dipoleDraw = dipolePlan.beats[0]?.draw;
  if (physics) {
    assert.ok(dipoleDraw);
    assert.equal(dipoleDraw!.kind, "vfpt_svg");
  } else {
    // No public VFPt files → sketch fallback still teaches structure.
    assert.ok(dipoleDraw);
    assert.equal(dipoleDraw!.kind, "tldraw_sketch");
  }

  // Idempotent: second attach does not double-draw.
  const again = attachVoiceDiagrams(dipolePlan);
  const draws = again.beats.filter((b) => b.draw && b.draw.kind !== "none");
  assert.equal(draws.length, 1);

  // Policy none: never attach.
  const skipPlan = basePlan("electric dipole", [
    "field lines leave +",
    "enter −",
  ]);
  skipPlan.beats[0]!.draw = {
    kind: "none",
    highlightIds: [],
    spec: { policy: "none" },
  };
  const skipped = attachVoiceDiagrams(skipPlan);
  assert.equal(skipped.beats[0]?.draw?.kind, "none");

  // Invalid VFPt draw on WWII is stripped.
  const bad = basePlan("World War II", ["allies", "axis", "1939"]);
  bad.beats[0]!.draw = {
    kind: "vfpt_svg",
    highlightIds: [],
    spec: { url: "/physics/vfpt/VFPt%20dipole.svg", label: "fake" },
  };
  const cleaned = attachVoiceDiagrams(bad);
  assert.notEqual(cleaned.beats[0]?.draw?.kind, "vfpt_svg");

  console.log("smoke-vfpt-voice-gate: ok", {
    physicsHit: Boolean(physics),
    minScore: VFPT_VOICE_MIN_SCORE,
  });
}

main();
