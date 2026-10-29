import assert from "node:assert/strict";
import { isFollowUpPrompt } from "../src/lib/browser-experience/followUp";
import {
  challengeFromUrlOrTitle,
} from "../src/lib/browser-experience/challenge";
import {
  classifyBrowserIntent,
  shouldSeekGroundVideo,
} from "../src/lib/browser-experience/intent";
import {
  actPlanSchema,
  teachPlanSchema,
} from "../src/lib/browser-experience/schemas";
import {
  beatsFromPlan,
  fallbackTeachPlan,
  limitBeats,
} from "../src/lib/browser-experience/teach";
import {
  hasDiagramEvidence,
  isLikelyDiagramImageUrl,
} from "../src/lib/browser-experience/search";
import {
  verifyPageForQuestion,
  wantsDiagram,
} from "../src/lib/browser-experience/verify";
import {
  embedUrlForId,
  extractYouTubeId,
  isYouTubeEmbedUrl,
  isYouTubeWatchUrl,
  wantsYouTube,
  watchUrlWithTime,
} from "../src/lib/browser-experience/youtube";
import {
  faviconForUrl,
  hostnameLabel,
  resolveOmniboxTarget,
  tabTitleFrom,
  toPublicTab,
} from "../src/lib/browser-experience/tabs";
import { tabBodySchema } from "../src/lib/browser-experience/schemas";
import { getMode, listEnabledModes, listModesByGroup } from "../src/modes/registry";

assert.equal(getMode("browser-experience")?.href, "/browser");
assert.equal(getMode("browser-experience")?.enabled, true);
assert.equal(getMode("browser-experience")?.navLabel, "Browser");

const learning = listEnabledModes("learning");
assert.ok(learning.some((m) => m.id === "browser-experience"));
assert.equal(learning[0]?.id, "smart-tutor");
assert.ok(!learning.some((m) => m.id === "physics-tutor"));
assert.ok(
  learning.findIndex((m) => m.id === "browser-experience") >
    learning.findIndex((m) => m.id === "smart-tutor"),
);

const studios = listModesByGroup("studio");
assert.ok(studios.some((m) => m.id === "browser-experience"));

const plan = teachPlanSchema.parse({
  title: "Photosynthesis",
  summary: "Plants turn light into chemical energy.",
  beats: [
    {
      id: "b1",
      speech: "This sentence defines photosynthesis.",
      annotation: { kind: "highlight", text: "photosynthesis" },
      holdMs: 800,
    },
    {
      id: "b2",
      speech: "Circle the word chlorophyll.",
      annotation: { kind: "circle", text: "chlorophyll", label: "Pigment" },
    },
  ],
});
assert.equal(plan.beats.length, 2);
assert.equal(plan.beats[0]?.annotation.kind, "highlight");

const fallback = fallbackTeachPlan({
  question: "What is photosynthesis?",
  source: {
    id: "S1",
    title: "Photosynthesis overview",
    url: "https://www.nasa.gov/photosynthesis",
    publisher: "nasa.gov",
    excerpt: "Plants convert light energy into chemical energy.",
  },
  pageTitle: "Photosynthesis",
  pageText:
    "Photosynthesis is the process by which green plants convert light energy into chemical energy. Chlorophyll absorbs sunlight in the leaf. Carbon dioxide and water become sugar and oxygen.",
  anchors: ["Chlorophyll", "Light energy", "Carbon dioxide"],
});
assert.ok(fallback.beats.length >= 1);
assert.ok(fallback.summary.length > 0);
assert.equal(fallback.beats[0]?.annotation.text, "Chlorophyll");

assert.equal(
  isFollowUpPrompt("explain to me the part of an airplane", {
    hasReadySession: true,
    priorQuestion: "what are the part of the heart",
  }),
  false,
);
assert.equal(
  isFollowUpPrompt("why is that important?", {
    hasReadySession: true,
    priorQuestion: "what are the part of the heart",
  }),
  true,
);
assert.equal(
  isFollowUpPrompt("what about the left atrium?", {
    hasReadySession: true,
    priorQuestion: "what are the part of the heart",
  }),
  true,
);

assert.equal(wantsDiagram("explain the diagram of the brain and its parts"), true);
assert.equal(hasDiagramEvidence("labeled brain diagram with parts"), true);
assert.equal(hasDiagramEvidence("beautiful sunset photo"), false);
assert.equal(
  isLikelyDiagramImageUrl(
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Brain_diagram.svg/800px-Brain_diagram.svg.png",
  ),
  true,
);
assert.equal(
  isLikelyDiagramImageUrl(
    "https://upload.wikimedia.org/wikipedia/commons/a/a1/RandomPersonPortrait.jpg",
  ),
  false,
);
assert.equal(
  isLikelyDiagramImageUrl("https://en.wikipedia.org/wiki/Brain"),
  false,
);
assert.equal(
  isLikelyDiagramImageUrl("https://images.unsplash.com/photo-123.png"),
  false,
);
// Relevance + diagram path is enough — no trusted-host allowlist.
assert.equal(
  isLikelyDiagramImageUrl(
    "https://cdn.example.com/assets/brain-diagram-labeled.png",
  ),
  true,
);

const goodBrain = verifyPageForQuestion(
  "explain the diagram of the brain and its parts",
  {
    title: "Brain Basics: Know Your Brain",
    url: "https://www.ninds.nih.gov/brain",
    text: "The brain is divided into the forebrain, midbrain, and hindbrain. The cerebellum coordinates movement. ".repeat(
      8,
    ),
    anchors: ["Forebrain", "Midbrain", "Hindbrain", "Cerebellum", "Brain stem"],
    hasLargeFigure: true,
  },
);
assert.equal(goodBrain.ok, true);

const thinOffTopic = verifyPageForQuestion(
  "explain the diagram of the brain and its parts",
  {
    title: "Airplane wings",
    url: "https://example.com/plane",
    text: "Wings generate lift for flight.",
    anchors: ["Wing", "Fuselage"],
    hasLargeFigure: false,
  },
);
assert.equal(thinOffTopic.ok, false);

assert.equal(wantsYouTube("explain this on youtube: photosynthesis"), true);
assert.equal(wantsYouTube("watch a video about the brain"), true);
assert.equal(wantsYouTube("explain the diagram of the brain"), false);
assert.equal(
  isYouTubeWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
  true,
);
assert.equal(isYouTubeWatchUrl("https://youtu.be/dQw4w9WgXcQ"), true);
assert.equal(isYouTubeWatchUrl("https://www.youtube.com/results?search_query=x"), false);
assert.equal(
  watchUrlWithTime("https://www.youtube.com/watch?v=dQw4w9WgXcQ", 42),
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
);
assert.equal(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.ok(isYouTubeEmbedUrl(embedUrlForId("dQw4w9WgXcQ", 12)));
assert.ok(embedUrlForId("dQw4w9WgXcQ", 12).includes("start=12"));

const clickPlan = teachPlanSchema.parse({
  title: "Expand section",
  summary: "Open the accordion then explain.",
  beats: [
    {
      id: "b1",
      speech: "I'll open this section.",
      annotation: { kind: "click", text: "Show more" },
      holdMs: 1000,
    },
    {
      id: "b2",
      speech: "Here is the detail that was hidden.",
      annotation: { kind: "highlight", text: "mitochondria" },
    },
  ],
});
assert.equal(clickPlan.beats[0]?.annotation.kind, "click");

const ytPlan = teachPlanSchema.parse({
  title: "YouTube photosynthesis",
  summary: "Play, seek, pause, explain.",
  beats: [
    {
      id: "b1",
      speech: "Starting the video.",
      annotation: { kind: "youtube_play" },
      holdMs: 1200,
    },
    {
      id: "b2",
      speech: "Pause here — this is the light reaction.",
      annotation: { kind: "youtube_seek", seconds: 45, label: "45s" },
      holdMs: 1400,
    },
    {
      id: "b3",
      speech: "One more key moment.",
      annotation: { kind: "youtube_pause" },
    },
  ],
});
assert.equal(ytPlan.beats[1]?.annotation.seconds, 45);
assert.equal(ytPlan.beats[0]?.annotation.kind, "youtube_play");

assert.equal(classifyBrowserIntent("how does water work"), "concept");
assert.equal(classifyBrowserIntent("Redis CrossSlot error 504"), "debug");
assert.equal(classifyBrowserIntent("photosynthesis diagram"), "default");
assert.equal(shouldSeekGroundVideo("concept", false), true);
assert.equal(shouldSeekGroundVideo("debug", false), false);
assert.equal(shouldSeekGroundVideo("default", true), true);

const roleBeats = beatsFromPlan(plan, "truth");
assert.equal(roleBeats[0]?.role, "truth");
assert.ok(roleBeats[0]?.id.startsWith("truth-"));
assert.equal(limitBeats(roleBeats, 1).length, 1);

const act = actPlanSchema.parse({
  questions: [
    {
      id: "q1",
      prompt: "What does chlorophyll do?",
      choices: ["Absorbs light", "Is a root", "Is gravity"],
      answerIndex: 0,
    },
    {
      id: "q2",
      prompt: "Where does this happen?",
      choices: ["In leaves", "Only in space", "In metal"],
      answerIndex: 0,
    },
  ],
});
assert.equal(act.questions.length, 2);

// Skip-Ground matrix shape (Truth + Act only)
const skipGroundRoles = ["truth", "act"] as const;
assert.deepEqual([...skipGroundRoles], ["truth", "act"]);

assert.equal(
  challengeFromUrlOrTitle(
    "https://www.google.com/sorry/index?continue=x",
    "Other",
  )?.severity,
  "major",
);
assert.equal(
  challengeFromUrlOrTitle(
    "https://example.com",
    "Unusual traffic from your computer network",
  )?.severity,
  "major",
);
assert.equal(
  challengeFromUrlOrTitle("https://en.wikipedia.org/wiki/Water", "Water"),
  null,
);
// Google OAuth is a core Take-control wall (Phase 1).
assert.equal(
  challengeFromUrlOrTitle(
    "https://accounts.google.com/signin/oauth",
    "Sign in",
  )?.severity,
  "major",
);
// Minor cookie / soft walls — agent should soft-continue, not skip the source.
assert.equal(
  challengeFromUrlOrTitle(
    "https://www.example.com/privacy/cookie-consent",
    "Cookie settings",
  )?.severity,
  "minor",
);
assert.equal(
  challengeFromUrlOrTitle("https://example.com/article", "Just a moment...")
    ?.severity,
  "minor",
);

// Multi-tab helpers (Muse-style strip)
assert.equal(hostnameLabel("https://www.google.com/search?q=x"), "google.com");
assert.ok(faviconForUrl("https://en.wikipedia.org/wiki/Water")?.includes("wikipedia"));
assert.equal(faviconForUrl("about:blank"), null);
assert.equal(tabTitleFrom("Photosynthesis", "https://nasa.gov/x"), "Photosynthesis");
assert.equal(tabTitleFrom("", "https://www.nasa.gov/x"), "nasa.gov");
const publicTab = toPublicTab({
  id: "t1",
  title: "Water",
  url: "https://en.wikipedia.org/wiki/Water",
  faviconUrl: faviconForUrl("https://en.wikipedia.org/wiki/Water"),
  kind: "truth",
  role: "truth",
  source: {
    id: "S1",
    title: "Water",
    url: "https://en.wikipedia.org/wiki/Water",
    publisher: "wikipedia.org",
    excerpt: "Water is…",
  },
});
assert.equal(publicTab.role, "truth");
assert.equal(publicTab.sourceId, "S1");
assert.equal(
  tabBodySchema.parse({ sessionId: "abc", action: "activate", tabId: "t1" })
    .action,
  "activate",
);
assert.equal(
  tabBodySchema.parse({ sessionId: "abc", action: "new" }).action,
  "new",
);
assert.equal(
  resolveOmniboxTarget("https://en.wikipedia.org/wiki/Water"),
  "https://en.wikipedia.org/wiki/Water",
);
assert.equal(resolveOmniboxTarget("nasa.gov"), "https://nasa.gov");
assert.ok(
  resolveOmniboxTarget("how does photosynthesis work").includes(
    "google.com/search",
  ),
);
assert.ok(
  resolveOmniboxTarget("how does photosynthesis work").includes(
    "photosynthesis",
  ),
);
assert.equal(
  tabBodySchema.parse({
    sessionId: "abc",
    action: "navigate",
    url: "how to work at amazon",
  }).action,
  "navigate",
);

const tabbedBeats = beatsFromPlan(plan, "truth", "tab-truth-1");
assert.equal(tabbedBeats[0]?.tabId, "tab-truth-1");
assert.equal(tabbedBeats[0]?.role, "truth");

console.log("browser-experience smoke checks passed");
