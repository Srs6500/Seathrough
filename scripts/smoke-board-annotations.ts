/**
 * Offline smoke: board annotation normalize / build / skip-if-missing.
 */
import assert from "node:assert/strict";
import {
  buildBoardAnnotations,
  normalizeBoardAnnotations,
  resolveExactPhrase,
  withNormalizedAnnotations,
} from "../src/lib/voice-tutor/boardAnnotations";
import type { BoardContent } from "../src/lib/voice-tutor/sessionTypes";
import { functionsVoicePlan, runVoiceTurn } from "../src/lib/voice-tutor/brain";

async function main() {
  const passage =
    "Photosynthesis converts light energy into chemical energy stored in glucose.";

  assert.equal(
    resolveExactPhrase(passage, "light energy"),
    "light energy",
  );
  assert.equal(resolveExactPhrase(passage, "not in passage"), null);

  // Exact match kept; missing phrase skipped.
  const normalized = normalizeBoardAnnotations(passage, {
    annotations: [
      {
        id: "a1",
        targetPhrase: "light energy",
        style: "circle",
        sideNote: "Energy in → sugar out.",
      },
      {
        id: "a2",
        targetPhrase: "unicorns dance",
        style: "circle",
        sideNote: "Should never appear",
      },
    ],
  });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]!.targetPhrase, "light energy");
  assert.equal(normalized[0]!.sideNote.includes("Energy"), true);

  // Legacy highlight → one annotation.
  const legacy = normalizeBoardAnnotations(passage, {
    highlight: "chemical energy",
    rememberTip: "Store it as sugar.",
    pointer: "both",
  });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]!.targetPhrase, "chemical energy");
  assert.equal(legacy[0]!.style, "both");

  // Overlap: keep first, drop later overlapping span.
  const overlap = normalizeBoardAnnotations(passage, {
    annotations: [
      {
        id: "o1",
        targetPhrase: "light energy into chemical",
        style: "underline",
        sideNote: "Longer span",
      },
      {
        id: "o2",
        targetPhrase: "chemical energy",
        style: "circle",
        sideNote: "Overlaps previous",
      },
    ],
  });
  assert.equal(overlap.length, 1);
  assert.equal(overlap[0]!.id, "o1");

  const built = buildBoardAnnotations({
    sourceText: passage,
    topic: "photosynthesis",
    highlight: "stored in glucose",
    rememberTip: "End product of the pathway.",
    examCue: "Where is the chemical energy stored?",
  });
  assert.ok(built.length >= 1);
  assert.ok(passage.includes(built[0]!.targetPhrase));

  const board: BoardContent = {
    sourceText: passage,
    highlight: "light energy",
    rememberTip: "Input of the process.",
    keyPoints: ["Light in", "Sugar out"],
  };
  const withAnn = withNormalizedAnnotations(board, "photosynthesis");
  assert.ok((withAnn.annotations?.length ?? 0) >= 1);
  assert.equal(withAnn.highlight, withAnn.annotations![0]!.targetPhrase);

  // Empty passage → board returned unchanged (no annotations invented).
  const empty = withNormalizedAnnotations(
    {
      sourceText: "   ",
      highlight: "nowhere",
      rememberTip: "n/a",
      keyPoints: [],
    },
    "topic",
  );
  assert.equal(empty.annotations?.length ?? 0, 0);

  // Functions plan (via brain sanitize path) should carry annotations when
  // source text + highlight exist.
  const plan = functionsVoicePlan();
  const withBoard = plan.beats.find(
    (b) => Boolean(b.board?.sourceText?.trim()) && Boolean(b.board?.highlight),
  );
  assert.ok(withBoard?.board, "functions plan should have a grounded board");

  // After a full turn propose, normalized plan boards include annotations.
  const propose = await runVoiceTurn({
    mode: "plan",
    userText: "vertical line test for functions",
    messages: [],
  });
  assert.equal(propose.action, "propose_topic");
  assert.ok(propose.plan);
  const annotatedBeat = propose.plan!.beats.find(
    (b) => (b.board?.annotations?.length ?? 0) > 0,
  );
  assert.ok(
    annotatedBeat,
    "propose_topic plan should attach at least one board annotation",
  );
  const ann = annotatedBeat!.board!.annotations![0]!;
  const src = annotatedBeat!.board!.sourceText || "";
  assert.ok(
    src.toLowerCase().includes(ann.targetPhrase.toLowerCase()),
    "annotation phrase must be an exact substring of sourceText",
  );
  assert.ok(ann.sideNote.trim().length > 0);

  console.log("smoke-board-annotations: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
