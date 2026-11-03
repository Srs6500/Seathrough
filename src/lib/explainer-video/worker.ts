/**
 * Local render worker for explainer videos. Runs only where the app itself
 * runs on a machine with the worker installed (see video-worker/README.md):
 * Python venv (Kokoro, faster-whisper), FFmpeg, and HyperFrames via npx.
 *
 * Jobs live on disk under .explainer-videos/<id>/ so the page can poll them.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { composeExplainer, LEAD_IN, type SfxInfo, type SfxName } from "@/lib/explainer-video/compose";
import { narrationText } from "@/lib/explainer-video/script";
import { alignScript } from "@/lib/explainer-video/timing";
import {
  spokenLines,
  type ExplainerJob,
  type ExplainerScript,
  type Orientation,
  type VoiceId,
  type WordTiming,
} from "@/lib/explainer-video/types";

const HYPERFRAMES = "hyperframes@0.8.223";
const ROOT = process.cwd();
const WORKER = path.join(ROOT, "video-worker");
const PYTHON = path.join(WORKER, ".venv", "bin", "python");
const JOBS = path.join(ROOT, ".explainer-videos");
const SFX: SfxName[] = ["pop", "whoosh", "tick-roll", "typing", "thud"];

/** Is the local toolchain present? The page shows setup steps when not. */
export async function workerStatus(): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = [];
  if (!existsSync(PYTHON)) missing.push("Python venv with Kokoro + faster-whisper (video-worker/setup.sh)");
  if (!(await commandWorks("ffmpeg", ["-version"]))) missing.push("FFmpeg");
  if (!(await commandWorks("espeak-ng", ["--version"]))) missing.push("espeak-ng");
  return { ready: missing.length === 0, missing };
}

// --- process helpers ------------------------------------------------------------

type RunResult = { code: number; stdout: string; stderr: string };

function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1", PYTHONWARNINGS: "ignore" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
      : undefined;
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function commandWorks(cmd: string, args: string[]): Promise<boolean> {
  try {
    return (await run(cmd, args, { timeoutMs: 10_000 })).code === 0;
  } catch {
    return false;
  }
}

/** voice.py prints one JSON object as its last stdout line. */
async function python<T>(args: string[], timeoutMs = 600_000): Promise<T> {
  const res = await run(PYTHON, [path.join(WORKER, "voice.py"), ...args], { timeoutMs });
  const last = res.stdout.trim().split("\n").pop() ?? "";
  if (res.code !== 0 || !last.startsWith("{")) {
    throw new Error(`Voice worker failed: ${res.stderr.trim().split("\n").slice(-3).join(" ")}`);
  }
  return JSON.parse(last) as T;
}

function hyperframes(args: string[], cwd: string, timeoutMs = 900_000) {
  return run("npx", ["--yes", HYPERFRAMES, ...args], { cwd, timeoutMs });
}

// --- job store ------------------------------------------------------------------

const jobDir = (id: string) => path.join(JOBS, id);
const SAFE_ID = /^[a-z0-9-]{8,64}$/;

export async function readJob(id: string): Promise<ExplainerJob | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(jobDir(id), "job.json"), "utf8")) as ExplainerJob;
  } catch {
    return null;
  }
}

async function saveJob(job: ExplainerJob) {
  const file = path.join(jobDir(job.id), "job.json");
  await writeFile(`${file}.tmp`, JSON.stringify(job, null, 2));
  await rename(`${file}.tmp`, file);
}

async function update(job: ExplainerJob, patch: Partial<ExplainerJob>) {
  Object.assign(job, patch);
  await saveJob(job);
}

/** Published files of a job (video, snapshots); null for anything else. */
export async function jobFile(id: string, name: string): Promise<{ file: string; type: string } | null> {
  if (!SAFE_ID.test(id) || !/^[a-z0-9._-]+$/i.test(name)) return null;
  const file = path.join(jobDir(id), "out", name);
  if (!existsSync(file)) return null;
  const type = name.endsWith(".mp4") ? "video/mp4" : name.endsWith(".png") ? "image/png" : "application/octet-stream";
  return { file, type };
}

// One pipeline at a time per job, surviving dev-server module reloads.
const running: Set<string> = ((globalThis as { __explainerRunning?: Set<string> }).__explainerRunning ??= new Set());

function launch(job: ExplainerJob, work: () => Promise<void>) {
  if (running.has(job.id)) return;
  running.add(job.id);
  void work()
    .catch(async (err) => {
      await update(job, { stage: "error", error: (err as Error).message || "Something went wrong.", detail: "Failed" });
    })
    .finally(() => running.delete(job.id));
}

// --- voice samples --------------------------------------------------------------

/** Line 1 read by each voice, cached by text. Returns sample file names. */
export async function voiceSamples(text: string, voices: VoiceId[]): Promise<{ key: string; voices: VoiceId[] }> {
  const key = createHash("sha1").update(`${text}|${voices.join(",")}`).digest("hex").slice(0, 16);
  const dir = path.join(JOBS, "samples", key);
  if (!voices.every((v) => existsSync(path.join(dir, `${v}.wav`)))) {
    await mkdir(dir, { recursive: true });
    await python(["samples", "--text", text, "--voices", voices.join(","), "--speed", "1.1", "--out-dir", dir]);
  }
  return { key, voices };
}

export function sampleFile(key: string, voice: string): string | null {
  if (!/^[a-f0-9]{16}$/.test(key) || !/^[a-z]{2}_[a-z]+$/.test(voice)) return null;
  const file = path.join(JOBS, "samples", key, `${voice}.wav`);
  return existsSync(file) ? file : null;
}

// --- pipeline: preview ------------------------------------------------------------

export async function createJob(input: {
  script: ExplainerScript;
  orientation: Orientation;
  voice: VoiceId;
}): Promise<ExplainerJob> {
  const job: ExplainerJob = {
    id: randomUUID(),
    createdAt: Date.now(),
    orientation: input.orientation,
    voice: input.voice,
    script: input.script,
    stage: "queued",
    detail: "Queued",
  };
  await mkdir(path.join(jobDir(job.id), "out"), { recursive: true });
  await saveJob(job);
  launch(job, () => buildPreview(job));
  return job;
}

async function sfxInfo(): Promise<SfxInfo> {
  const files = SFX.map((name) => path.join(WORKER, "assets", "sfx", `${name}.mp3`));
  const { peaks } = await python<{ peaks: Record<string, { peak: number; duration: number }> }>(["peaks", ...files]);
  return Object.fromEntries(SFX.map((name) => [name, peaks[`${name}.mp3`]!])) as SfxInfo;
}

async function buildPreview(job: ExplainerJob) {
  const dir = jobDir(job.id);
  const project = path.join(dir, "project");
  await rm(project, { recursive: true, force: true });
  await mkdir(path.join(project, "assets"), { recursive: true });

  // 1. Voice: whole script at speed 1.1, pauses over 0.24 s cut to 0.24 s.
  await update(job, { stage: "voice", detail: "Recording the voice" });
  const textFile = path.join(dir, "narration.txt");
  await writeFile(textFile, narrationText(job.script));
  const voiceFile = path.join(project, "assets", "voice.wav");
  const voice = await python<{ duration: number; mouth: number[] }>([
    "voice",
    "--text-file",
    textFile,
    "--voice",
    job.voice,
    "--speed",
    "1.1",
    "--out",
    voiceFile,
  ]);
  // Keep the untrimmed take out of the project folder (only one source of audio there).
  const raw = voiceFile.replace(/\.wav$/, ".raw.wav");
  if (existsSync(raw)) await rename(raw, path.join(dir, "voice.raw.wav"));

  // 2. Timing: whisper word starts on the final voice file, matched to the script.
  await update(job, { stage: "timing", detail: "Timing every word" });
  const { words } = await python<{ words: WordTiming[] }>([
    "align",
    "--input",
    voiceFile,
    "--prompt",
    job.script.points.flatMap((p) => p.title).join(", "),
  ]);
  const lines = alignScript(spokenLines(job.script), words, LEAD_IN);
  await writeFile(path.join(dir, "words.json"), JSON.stringify({ words, lines }, null, 2));

  // 3. Build the HyperFrames project.
  await update(job, { stage: "building", detail: "Building scenes" });
  const composed = composeExplainer({
    script: job.script,
    orientation: job.orientation,
    lines,
    mouth: voice.mouth,
    voiceDuration: voice.duration,
    sfx: await sfxInfo(),
    gsapFile: "src/gsap.min.js",
  });
  for (const [rel, content] of Object.entries(composed.files)) {
    const file = path.join(project, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await mkdir(path.join(project, "src"), { recursive: true });
  await copyFile(path.join(ROOT, "node_modules", "gsap", "dist", "gsap.min.js"), path.join(project, "src", "gsap.min.js"));
  await cp(path.join(WORKER, "assets", "fonts"), path.join(project, "assets", "fonts"), { recursive: true });
  await mkdir(path.join(project, "assets", "sfx"), { recursive: true });
  for (const name of SFX) {
    await copyFile(path.join(WORKER, "assets", "sfx", `${name}.mp3`), path.join(project, "assets", "sfx", `${name}.mp3`));
  }
  await copyFile(path.join(WORKER, "assets", "music", "bed.mp3"), path.join(project, "assets", "music.mp3"));
  await copyFile(path.join(WORKER, "assets", "grain.png"), path.join(project, "assets", "grain.png"));
  await writeFile(
    path.join(project, "hyperframes.json"),
    JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", assets: "assets" } }, null, 2),
  );
  await writeFile(path.join(project, "meta.json"), JSON.stringify({ id: job.id, name: job.script.topic }, null, 2));
  await update(job, { duration: composed.duration });

  // 4. Check until 0 errors (the build is generated, so one failing pass is a bug: report it).
  await update(job, { stage: "checking", detail: "Checking the composition" });
  const errors = await checkErrors(project);
  if (errors.length) throw new Error(`HyperFrames check found ${errors.length} error(s): ${errors.slice(0, 3).join("; ")}`);

  // 5. Review frames: frame 1, each point built and acted out, the close.
  await update(job, { stage: "snapshots", detail: "Taking review snapshots" });
  const shotsDir = path.join(dir, "snapshots");
  await rm(shotsDir, { recursive: true, force: true });
  const times = composed.review.map((r) => r.time);
  const shot = await hyperframes(["snapshot", "--at", times.join(","), "--no-end", "--keep", "-o", shotsDir], project, 300_000);
  if (shot.code !== 0) throw new Error(`Snapshot failed: ${tail(shot)}`);
  const pngs = (await readdir(shotsDir)).filter((f) => f.endsWith(".png"));
  const snapshots: ExplainerJob["snapshots"] = [];
  const labels = composed.review.map((r) => r.label);
  for (const [i, t] of times.entries()) {
    const png = pngs.find((f) => f === `at-${formatSeconds(t)}s.png`);
    if (!png) continue;
    const name = `snap-${i}.png`;
    await copyFile(path.join(shotsDir, png), path.join(dir, "out", name));
    snapshots.push({ label: labels[i]!, file: name });
  }
  await update(job, { stage: "preview", detail: "Ready to render", snapshots });
}

async function checkErrors(project: string): Promise<string[]> {
  const res = await hyperframes(["check", "--json", "--no-contrast"], project, 300_000);
  const start = res.stdout.indexOf("{");
  if (start < 0) {
    if (res.code === 0) return [];
    throw new Error(`HyperFrames check failed: ${tail(res)}`);
  }
  const report = JSON.parse(res.stdout.slice(start)) as {
    ok?: boolean;
    errorCount?: number;
    issues?: Array<{ severity?: string; message?: string; code?: string }>;
    findings?: Array<{ severity?: string; message?: string; code?: string }>;
  };
  const issues = report.issues ?? report.findings ?? [];
  const errs = issues.filter((i) => i.severity === "error").map((i) => i.message ?? i.code ?? "error");
  if (!errs.length && report.ok === false && res.code !== 0) return [`check failed: ${tail(res)}`];
  return errs;
}

function formatSeconds(t: number) {
  return String(Number(t.toFixed(3)));
}

function tail(res: RunResult) {
  return (res.stderr || res.stdout).trim().split("\n").slice(-4).join(" ");
}

// --- pipeline: render ----------------------------------------------------------------

export async function startRender(id: string): Promise<ExplainerJob | null> {
  const job = await readJob(id);
  if (!job) return null;
  if (job.stage !== "preview" && job.stage !== "error") return job;
  if (!existsSync(path.join(jobDir(id), "project", "index.html"))) return job;
  await update(job, { stage: "rendering", detail: "Rendering frames", error: undefined });
  launch(job, () => render(job));
  return job;
}

async function render(job: ExplainerJob) {
  const dir = jobDir(job.id);
  const project = path.join(dir, "project");
  const rendered = path.join(dir, "render.mp4");
  const res = await hyperframes(["render", "-q", "delivery", "-f", "30", "-o", rendered, "--quiet"], project, 3_600_000);
  if (res.code !== 0 || !existsSync(rendered)) throw new Error(`Render failed: ${tail(res)}`);

  // Final mix around -15 LUFS (two-pass loudnorm), picture copied as is.
  await update(job, { stage: "mixing", detail: "Mixing to -15 LUFS" });
  const measure = await run("ffmpeg", ["-hide_banner", "-i", rendered, "-af", "loudnorm=I=-15:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
  const json = measure.stderr.slice(measure.stderr.lastIndexOf("{"), measure.stderr.lastIndexOf("}") + 1);
  const m = JSON.parse(json) as Record<string, string>;
  const filter = `loudnorm=I=-15:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const name = `explainer-${job.orientation}.mp4`;
  const final = path.join(dir, "out", name);
  const mix = await run("ffmpeg", ["-y", "-hide_banner", "-i", rendered, "-c:v", "copy", "-af", filter, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final]);
  if (mix.code !== 0) throw new Error(`Audio mix failed: ${tail(mix)}`);
  const size = (await stat(final)).size;
  await update(job, { stage: "done", detail: `Done · ${(size / 1e6).toFixed(1)} MB`, video: name });
}
