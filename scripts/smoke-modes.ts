import assert from "node:assert/strict";
import {
  getMode,
  listEnabledModes,
  listModesByGroup,
  listSiblingModes,
} from "../src/modes/registry";

const learning = listEnabledModes("learning");
assert.equal(learning.length, 6);
assert.equal(learning[0]?.id, "smart-tutor");
assert.equal(learning[1]?.id, "physics-tutor");
assert.equal(learning[2]?.id, "browser-experience");
assert.equal(learning[3]?.id, "dashboard");
assert.equal(learning[4]?.id, "system-design");
assert.equal(learning[5]?.id, "explain-video");
assert.equal(getMode("smart-tutor")?.href, "/smart-tutor");
assert.equal(getMode("physics-tutor")?.href, "/smart-tutor/physics-tutor");
assert.equal(getMode("browser-experience")?.href, "/browser");
assert.equal(getMode("dashboard")?.href, "/dashboard");
assert.equal(getMode("data-flow")?.href, "/data-flow");
assert.equal(getMode("bug-analyzer")?.href, "/bug-analyzer");
assert.equal(getMode("ai-tutor-v2")?.href, "/ai-tutor-v2");
assert.equal(getMode("smart-tutor")?.enabled, true);
assert.equal(getMode("physics-tutor")?.enabled, true);
assert.equal(getMode("browser-experience")?.enabled, true);
assert.equal(getMode("dashboard")?.enabled, true);
assert.equal(getMode("data-flow")?.enabled, true);
assert.equal(getMode("bug-analyzer")?.enabled, true);
assert.equal(getMode("ai-tutor-v2")?.enabled, true);
assert.equal(getMode("smart-tutor")?.navLabel, "Smart tutor");
assert.equal(getMode("physics-tutor")?.navLabel, "Physics");
assert.equal(getMode("browser-experience")?.navLabel, "Browser");
assert.equal(getMode("dashboard")?.navLabel, "Dashboard");
assert.equal(getMode("data-flow")?.navLabel, "Data flow");
assert.equal(getMode("bug-analyzer")?.navLabel, "Bug analyzer");
assert.equal(getMode("ai-tutor-v2")?.navLabel, "Tutor v2");

assert.equal(getMode("lessons")?.href, "/lessons");
assert.equal(getMode("lessons")?.enabled, false);
assert.equal(getMode("ai-tutor")?.href, "/ai-tutor");
assert.equal(getMode("ai-tutor")?.enabled, false);
assert.equal(getMode("figures-3d")?.enabled, false);
assert.equal(getMode("screenshot-explain")?.enabled, false);
assert.equal(getMode("system-design")?.enabled, true);
assert.equal(getMode("leetcode")?.enabled, false);
assert.equal(getMode("automatic-drawing")?.enabled, false);
assert.equal(getMode("draw-engine")?.enabled, false);
assert.equal(getMode("scene-explain")?.enabled, false);
assert.equal(getMode("scene-explain")?.href, "/lessons?view=3d");

const studios = listModesByGroup("studio");
assert.equal(studios.length, 6);
assert.equal(studios[0]?.id, "smart-tutor");
assert.equal(studios[1]?.id, "physics-tutor");
assert.equal(studios[2]?.id, "browser-experience");
assert.equal(studios[3]?.id, "dashboard");
assert.equal(studios[4]?.id, "system-design");
assert.equal(studios[5]?.id, "explain-video");
assert.equal(getMode("explain-video")?.href, "/video");
assert.equal(getMode("explain-video")?.enabled, true);
assert.ok(!studios.some((m) => m.id === "lessons"));
assert.ok(!studios.some((m) => m.id === "figures-3d"));
assert.ok(!studios.some((m) => m.id === "ai-tutor"));

const siblings = listSiblingModes("smart-tutor");
assert.ok(siblings.every((m) => m.id !== "smart-tutor"));
assert.equal(siblings.length, 5);
assert.equal(siblings[0]?.id, "physics-tutor");
assert.equal(siblings[1]?.id, "browser-experience");
assert.equal(siblings[2]?.id, "dashboard");
assert.equal(siblings[3]?.id, "system-design");
assert.equal(siblings[4]?.id, "explain-video");
assert.ok(!listEnabledModes().some((m) => m.id === "lessons"));
assert.ok(!listEnabledModes().some((m) => m.id === "ai-tutor"));
assert.ok(listEnabledModes().some((m) => m.id === "ai-tutor-v2"));
assert.ok(listEnabledModes().some((m) => m.id === "data-flow"));
assert.ok(listEnabledModes().some((m) => m.id === "bug-analyzer"));
assert.ok(!listEnabledModes().some((m) => m.id === "figures-3d"));

const labs = listModesByGroup("lab");
assert.ok(labs.some((m) => m.id === "ai-tutor-v2"));

console.log("modes registry smoke checks passed");
