/**
 * Offline smoke for Voice Tutor DNA rewrite:
 * Functions plan builds, lock lines start immediately, assess keywords work.
 */
import assert from "node:assert/strict";
import {
  functionsVoicePlan,
  runVoiceTurn,
} from "../src/lib/voice-tutor/brain";
import {
  LIVE_BARGE_ANSWERS,
  MAX_LESSON_BARGE_DOUBTS,
  casualFocusSay,
  extractTopicFromNudge,
  isTopicSwitchAway,
  looksLikeMumble,
  looksLikeParkLanguage,
  looksLikeTopicNudge,
  qualifyFocusWithParent,
  resolveFocusChoice,
  spokenTopicLockSay,
} from "../src/lib/voice-tutor/intakeShared";
import { pickHighlight } from "../src/lib/voice-tutor/pickHighlight";

async function main() {
  // Barge park budget: 2 live partials, then park (threshold = 3rd).
  assert.equal(LIVE_BARGE_ANSWERS, 2);
  assert.equal(MAX_LESSON_BARGE_DOUBTS, 3);
  assert.equal(looksLikeParkLanguage("I'll cover that at the end of the lesson"), true);
  assert.equal(looksLikeParkLanguage("Here's one piece now: use the marked line"), false);

  const greet = await runVoiceTurn({ mode: "greet", messages: [] });
  assert.equal(greet.action, "speak");
  assert.ok(greet.say.length > 10);

  const plan = functionsVoicePlan();
  assert.equal(plan.topic.includes("Function") || plan.label.includes("Function"), true);
  assert.ok(plan.beats.length >= 3);
  assert.ok(plan.beats.some((beat) => beat.expectAnswer));
  assert.ok(
    plan.beats.some(
      (beat) => beat.draw && beat.draw.kind === "svg_graph",
    ),
  );
  assert.ok(
    plan.beats.some(
      (beat) =>
        Boolean(beat.board?.sourceText) &&
        (beat.board?.keyPoints?.length ?? 0) > 0,
    ),
    "glass board should carry grounded text + key points",
  );

  // Speech must not advertise UI meta or point at the board instead of teaching.
  for (const beat of plan.beats) {
    assert.equal(/\bbullets?\b|\bpanel\b|\bUI\b/i.test(beat.say), false);
    assert.equal(
      /\bhere's what\b.+\bis about\b|\bthe marked line\b/i.test(beat.say),
      false,
    );
  }

  const propose = await runVoiceTurn({
    mode: "plan",
    userText: "vertical line test for functions",
    messages: [],
  });
  assert.equal(propose.action, "propose_topic");
  assert.equal(propose.lockSeconds, undefined);
  assert.equal(/\bstarting in\b|\b\d+\s+seconds?\b/i.test(propose.say), false);
  assert.ok(propose.plan);

  const lockLine = spokenTopicLockSay("Newton's second law");
  assert.equal(/\bstarting in\b|\b\d+\s+seconds?\b/i.test(lockLine), false);
  const lockFinal = spokenTopicLockSay("Newton's second law", { final: true });
  assert.equal(/\bstarting in\b|\b\d+\s+seconds?\b/i.test(lockFinal), false);

  // Mumble / filler must not invent a lesson.
  assert.equal(looksLikeMumble("um"), true);
  assert.equal(looksLikeMumble("uh huh"), true);
  assert.equal(looksLikeMumble("baking bread"), false);
  const mumble = await runVoiceTurn({
    mode: "chat",
    userText: "umm",
    messages: [],
  });
  assert.equal(mumble.action, "speak");
  assert.equal(mumble.plan == null, true);

  // Broad topics ask for focus before any lock/plan.
  const cooking = await runVoiceTurn({
    mode: "chat",
    userText: "cooking",
    messages: [],
  });
  assert.ok(
    cooking.action === "clarify_focus" || cooking.action === "propose_topic",
    "broad topic should clarify or (if model is specific) propose",
  );
  if (cooking.action === "clarify_focus") {
    assert.ok((cooking.focusOptions?.length ?? 0) >= 2);
    assert.equal(cooking.plan == null, true);
    for (const opt of cooking.focusOptions ?? []) {
      const bare = opt
        .trim()
        .toLowerCase()
        .replace(/\bcooking\b/g, "")
        .replace(/\b(of|in|for|about|the|and|a|an)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      assert.equal(
        /^(theory|applications?|examples?|concepts?|basics?|general|core ideas?|key terms?|practice problems?)$/i.test(
          bare || opt.trim(),
        ),
        false,
        `hollow shell focus option: ${opt}`,
      );
    }
  }

  // Mid-lesson partial must not speak park/defer language.
  const partial = await runVoiceTurn({
    mode: "chat",
    userText: "wait why does that matter?",
    messages: [],
    activeTopic: "photosynthesis",
    teaching: true,
    partialAside: true,
    lessonContext: {
      beatSay: "Light reactions split water and energize carriers.",
      highlight: "split water and energize carriers",
      rememberTip: "When you see light reactions, ask what gets split.",
    },
  });
  assert.equal(partial.action, "speak");
  assert.equal(looksLikeParkLanguage(partial.say), false);
  assert.equal(partial.showOnBoard, false);

  // End-of-lesson deferred scaffold returns drip pieces.
  const deferred = await runVoiceTurn({
    mode: "chat",
    userText: "why do we need chlorophyll?",
    messages: [],
    activeTopic: "photosynthesis",
    teaching: true,
    deferredClose: true,
    lessonContext: {
      highlight: "chlorophyll absorbs light energy",
      rememberTip: "No pigment → no captured photons → no light reactions.",
    },
  });
  assert.equal(deferred.action, "speak");
  assert.ok(deferred.deferredPieces?.piece1);
  assert.ok(deferred.deferredPieces?.piece2);
  assert.ok(deferred.deferredPieces?.full);
  assert.ok(deferred.boardNote);

  // Casual focus line — never spoken as "1) 2) 3)".
  const casual = casualFocusSay("building an airplane", [
    "the engines",
    "avionics",
    "how wings make lift",
  ]);
  assert.equal(/\b1\)|\b2\)|option\s*1/i.test(casual), false);
  assert.ok(/engines/i.test(casual) && /avionics/i.test(casual));

  // After options: a pick must propose, never clarify again.
  assert.equal(
    resolveFocusChoice("2", "cooking", ["Sautéing", "Baking", "Grilling"]),
    "Baking",
  );
  assert.equal(looksLikeTopicNudge("let's actually learn about physics"), true);
  assert.equal(
    extractTopicFromNudge("let's actually learn about physics").toLowerCase(),
    "physics",
  );
  // Bare focus words must stay under the parent (not "software applications").
  assert.equal(
    qualifyFocusWithParent("applications", "physics").toLowerCase(),
    "applications of physics",
  );
  assert.equal(
    qualifyFocusWithParent("physics applications", "physics").toLowerCase(),
    "physics applications",
  );
  assert.equal(
    isTopicSwitchAway(
      "let's actually learn about physics",
      "cooking",
      ["Sautéing", "Baking", "Grilling"],
    ),
    true,
  );
  assert.equal(
    isTopicSwitchAway("baking", "cooking", ["Sautéing", "Baking", "Grilling"]),
    false,
  );

  const focusPick = await runVoiceTurn({
    mode: "chat",
    userText: "baking",
    messages: [],
    awaitingFocus: true,
    parentTopic: "cooking",
    focusOptions: ["Sautéing", "Baking", "Grilling"],
  });
  assert.equal(focusPick.action, "propose_topic");
  assert.ok(/bak/i.test(focusPick.topic || ""));
  assert.equal(focusPick.lockSeconds, undefined);
  assert.equal(/\bstarting in\b|\b\d+\s+seconds?\b/i.test(focusPick.say), false);

  // Nudge mid-clarify → new topic clarify, not a cooking subtopic.
  const nudged = await runVoiceTurn({
    mode: "chat",
    userText: "wait let's actually learn about airplanes",
    messages: [],
    awaitingFocus: true,
    parentTopic: "cooking",
    focusOptions: ["Sautéing", "Baking", "Grilling"],
  });
  assert.equal(nudged.action, "clarify_focus");
  assert.ok(/airplane/i.test(nudged.parentTopic || nudged.topic || ""));

  // Open topics must NOT be forced onto the Functions seed.
  const open = await runVoiceTurn({
    mode: "plan",
    userText: "photosynthesis and the Calvin cycle",
    messages: [],
  });
  assert.equal(open.action, "propose_topic");
  assert.ok(open.plan);
  assert.equal(
    /function|vertical-line/i.test(open.plan!.topic),
    false,
    "open topics must stay open — not hardwired to Functions",
  );

  // Teach before check — first two beats must explain, not quiz.
  const relativity = await runVoiceTurn({
    mode: "plan",
    userText: "theory of relativity",
    messages: [],
  });
  assert.ok(relativity.plan);
  const early = relativity.plan!.beats.slice(0, 2);
  assert.ok(
    early.every((b) => !b.expectAnswer),
    "first two beats must teach before any check",
  );
  assert.ok(
    relativity.plan!.beats.some((b) => b.expectAnswer),
    "lesson still includes a later check",
  );

  // Off-topic mid-lesson: voice redirect, keep off the board.
  const aside = await runVoiceTurn({
    mode: "chat",
    userText: "How many languages do you understand?",
    messages: [],
    activeTopic: "theory of relativity",
    teaching: true,
  });
  assert.equal(aside.action, "redirect");
  assert.equal(aside.showOnBoard, false);

  // Ranked highlight must prefer concept substance over meta "definition".
  const gaussian =
    "A Gaussian surface is a closed surface chosen so that Gauss's law becomes easy to apply. The surface is imaginary; you pick its shape to match the symmetry of the charge distribution.";
  const picked = pickHighlight(gaussian, "Gaussian surface", "definition");
  assert.ok(picked);
  assert.equal(/\bdefinition\b/i.test(picked!), false);
  assert.ok(/gaussian|closed surface|gauss|symmetry|imaginary/i.test(picked!));

  // Student-POV: prefer plain "what it is" over paper-ish phrasing.
  const learner = pickHighlight(
    "A capacitor stores energy in an electric field. Pursuant to the aforementioned formalism, boundary conditions apply respectively.",
    "capacitor",
  );
  assert.ok(learner);
  assert.equal(/\bpursuant|aforementioned|respectively\b/i.test(learner!), false);
  assert.ok(/stores energy|electric field|capacitor/i.test(learner!));

  const openPlan = await runVoiceTurn({
    mode: "plan",
    userText: "what is a gaussian surface",
    messages: [],
  });
  const firstBoard = openPlan.plan?.beats[0]?.board;
  assert.ok(firstBoard?.sourceText && firstBoard.sourceText.length > 40);
  assert.equal(/\bwe'll unpack\b/i.test(firstBoard!.sourceText!), false);
  assert.equal(
    /\bobject, rule, or construction\b/i.test(firstBoard!.sourceText!),
    false,
    "must never use the old STEM shell on open topics",
  );
  assert.equal(
    /\bwhile solving a problem\b/i.test(firstBoard!.sourceText!),
    false,
  );
  assert.ok(firstBoard?.highlight);
  assert.equal(/^(definition|conditions)$/i.test(firstBoard!.highlight!.trim()), false);

  const ww2 = await runVoiceTurn({
    mode: "plan",
    userText: "I wanna learn about World War Two",
    messages: [],
  });
  const ww2Text = ww2.plan?.beats[0]?.board?.sourceText || "";
  assert.equal(
    /\bobject, rule, or construction\b/i.test(ww2Text),
    false,
    "WWII must not get STEM template prose",
  );

  console.log("smoke-voice-tutor: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
