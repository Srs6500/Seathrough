/**
 * Dev runner: build an explainer preview from a fixed script (no LLM).
 *   npm run explainer:dev -- [vertical|horizontal] [voice] [--render]
 */
import { readFile } from "node:fs/promises";
import { createJob, readJob, startRender } from "@/lib/explainer-video/worker";
import { scriptSchema, type Orientation, type VoiceId } from "@/lib/explainer-video/types";
import { scriptProblems } from "@/lib/explainer-video/script";

const [orientation = "vertical", voice = "am_michael"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const doRender = process.argv.includes("--render");

async function waitFor(id: string, stages: string[]) {
  let last = "";
  for (;;) {
    const job = await readJob(id);
    if (job && job.detail !== last) {
      last = job.detail;
      console.log(`[${job.stage}] ${job.detail}${job.error ? ` — ${job.error}` : ""}`);
    }
    if (!job || stages.includes(job.stage) || job.stage === "error") return job;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const script = scriptSchema.parse(JSON.parse(await readFile("scripts/explainer/fixture.json", "utf8")));
console.log("problems:", scriptProblems(script));
const job = await createJob({ script, orientation: orientation as Orientation, voice: voice as VoiceId });
console.log("job", job.id);
const preview = await waitFor(job.id, ["preview"]);
console.log(JSON.stringify(preview?.snapshots), preview?.duration);
if (doRender && preview?.stage === "preview") {
  await startRender(job.id);
  await waitFor(job.id, ["done"]);
}
