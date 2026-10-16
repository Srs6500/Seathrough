import assert from "node:assert/strict";
import { getMode, listEnabledModes, listModesByGroup } from "../src/modes/registry";
import { buildPhysicsTutorContext, formatPhysicsContextBlock } from "../src/lib/physics-tutor/context";
import { listVfptDiagrams, pickDiagramsForPrompt } from "../src/lib/physics-tutor/diagrams";
import { loadPhysicsPedagogyRules } from "../src/lib/physics-tutor/pedagogy";
import {
  physicsCorpusStats,
  retrievePhysicsChunks,
} from "../src/lib/physics-tutor/retrieve";

assert.equal(getMode("physics-tutor")?.href, "/smart-tutor/physics-tutor");
assert.equal(getMode("physics-tutor")?.enabled, true);
assert.equal(getMode("physics-tutor")?.usesWhiteboard, true);
assert.ok(listEnabledModes("learning").some((m) => m.id === "physics-tutor"));
assert.ok(listModesByGroup("studio").some((m) => m.id === "physics-tutor"));

const rules = loadPhysicsPedagogyRules();
assert.ok(rules.length > 40);
assert.match(rules, /field lines|Smart-tutor|beat/i);

const stats = physicsCorpusStats();
assert.ok(stats.seed >= 8, "seed corpus should ship with electrostatics chunks");
assert.equal(typeof stats.ingested, "number");

const empty = retrievePhysicsChunks("   ");
assert.equal(empty.length, 0);

const dipoleHits = retrievePhysicsChunks("explain an electric dipole field");
assert.ok(dipoleHits.length >= 1);
assert.ok(
  dipoleHits.some((h) => /dipole/i.test(h.topic + h.title + h.text)),
  "dipole ask should retrieve dipole chunk",
);

const capacitorHits = retrievePhysicsChunks("what is a parallel plate capacitor");
assert.ok(capacitorHits.some((h) => /capacitor/i.test(h.topic + h.title)));

const ctx = buildPhysicsTutorContext("electric field of two opposite charges");
assert.ok(ctx.chunks.length >= 1);
assert.ok(ctx.pedagogyRules.length > 20);
const block = formatPhysicsContextBlock(ctx);
assert.match(block, /PHYSICS MODE/);
assert.match(block, /PEDAGOGY RULES/);
assert.match(block, /RETRIEVED CONTEXT/);

// Diagram catalog: works with 0 files; when SVGs exist, picker returns some.
const all = listVfptDiagrams();
const picked = pickDiagramsForPrompt("electric dipole", 4);
assert.ok(Array.isArray(picked));
if (all.length > 0) {
  assert.ok(picked.length >= 1);
}

// Empty RAG path still formats a usable block
const bare = formatPhysicsContextBlock({
  pedagogyRules: "Keep beats short.",
  chunks: [],
  diagrams: [],
});
assert.match(bare, /No textbook chunks matched/);
assert.match(bare, /No local VFPt SVGs yet/);

console.log("physics tutor smoke checks passed", {
  seed: stats.seed,
  ingested: stats.ingested,
  vfptDiagrams: all.length,
});
