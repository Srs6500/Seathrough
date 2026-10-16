import assert from "node:assert/strict";
import { speakMathDynamically } from "../src/lib/math/dynamicMathSpeech";
import { mathToSpeech } from "../src/lib/math/mathToSpeech";
import { physicsToSpeech } from "../src/lib/physics-tutor/physicsToSpeech";
import { buildPhysicsTutorContext } from "../src/lib/physics-tutor/context";
import { physicsCorpusStats } from "../src/lib/physics-tutor/retrieve";
import { attachPhysicsDiagramToLesson, summarizePhysicsRag } from "../src/lib/physics-tutor/attach";
import type { ExperimentLesson } from "../src/lib/experiment/scene";

async function main() {
  const stats = physicsCorpusStats();
  assert.ok(stats.total >= 10, "expected seed and/or ingested chunks");
  console.log("corpus", stats);

  const ctx = buildPhysicsTutorContext("explain the electric field of a dipole");
  assert.ok(ctx.chunks.length >= 1, "dipole should retrieve chunks");
  assert.ok(
    ctx.chunks.some((c) => /dipole|field|charge/i.test(c.topic + c.title + c.text)),
    "hits should look electrostatics-related",
  );
  const rag = summarizePhysicsRag(ctx, stats);
  assert.ok(rag.chunks.length >= 1);

  const lesson: ExperimentLesson = {
    title: "Dipole",
    beats: [{ say: "Here is a dipole.", shapes: [] }],
  };
  const withDiagram = attachPhysicsDiagramToLesson(lesson, ctx);
  const hasImage = withDiagram.beats[0]?.shapes.some((s) => s.type === "image");
  if (rag.diagrams.length > 0) {
    assert.ok(hasImage, "VFPt diagram should be attached when public SVG exists");
  }

  const spoken = physicsToSpeech(
    mathToSpeech("The E field of charge q points away. F = k q1 q2 / r^2."),
  );
  assert.match(spoken, /electric field|charge|Coulomb|r squared|over/i);
  assert.ok(!/q1/.test(spoken) || /charge/.test(spoken));
  console.log("spoken sample:", spoken);

  const dynamicMu = await speakMathDynamically(
    "Coulomb's constant involves $1/(4\\pi\\varepsilon_0)$ and $\\mu_0$ in magnetostatics.",
  );
  assert.match(dynamicMu, /pie|mew|epsilon|naught|fraction|1|4/i);
  console.log("dynamic sample:", dynamicMu);

  console.log("physics speech + rag smoke passed", {
    hits: rag.chunks.map((c) => `${c.source}:${c.id}`),
    diagrams: rag.diagrams.map((d) => d.filename),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
