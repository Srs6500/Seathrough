import {
  FilmEngine,
  type EngineConfig,
  type ProbeResult,
} from "@/components/explain-video/engine";
import { LOOK_PALETTE, type Plan } from "@/lib/explain-video/film";

/** A scene slower than this per frame is sent back to be simplified. */
const SLOW_FRAME_MS = 350;
/** Rough ceiling on how long drawing every frame may take before we drop quality. */
const RENDER_BUDGET_SECONDS = 80;

export type DirectorStatus =
  | { kind: "checking"; index: number; total: number }
  | { kind: "repairing"; count: number };

export type Directed = {
  engine: FilmEngine;
  codes: (string | null)[];
  fallbacks: number[];
  fps: 12 | 24;
  width: number;
};

export function filmEngineConfig(plan: Plan, fps: 12 | 24, width: number): EngineConfig {
  return {
    palette: LOOK_PALETTE[plan.look],
    fps,
    width,
    scenes: plan.scenes.map((scene) => ({ title: scene.title, say: scene.say, seconds: scene.seconds })),
  };
}

function problem(result: ProbeResult): string | null {
  if (result.error) return result.error;
  if (result.blank) return "The scene drew nothing visible above the caption band. Draw the picture it describes.";
  if (result.ms > SLOW_FRAME_MS) {
    return `The scene takes ${Math.round(result.ms)} ms per frame. Keep it under 120 ms: fewer hatch/surface/dotScreen calls, smaller areas, fewer loop iterations.`;
  }
  return null;
}

async function probeAll(
  engine: FilmEngine,
  indexes: number[],
  onStatus: (status: DirectorStatus) => void,
  total: number,
  isCancelled: () => boolean,
): Promise<Map<number, ProbeResult>> {
  const results = new Map<number, ProbeResult>();
  for (const index of indexes) {
    if (isCancelled()) break;
    onStatus({ kind: "checking", index, total });
    const loadError = engine.loadErrors[String(index)];
    if (loadError) {
      results.set(index, { index, error: loadError, ms: 0, blank: false });
      continue;
    }
    try {
      results.set(index, await engine.probe(index));
    } catch (error) {
      results.set(index, {
        index,
        error: error instanceof Error ? error.message : "The scene stopped responding.",
        ms: 0,
        blank: false,
      });
    }
  }
  return results;
}

type RepairReply = { repairs?: { index: number; code: string | null; error?: string }[]; error?: string };

async function requestRepairs(
  topic: string,
  plan: Plan,
  repairs: { index: number; code: string | null; error: string }[],
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  try {
    const response = await fetch("/api/explain-video/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, plan, repairs }),
    });
    const payload = (await response.json().catch(() => null)) as RepairReply | null;
    if (!response.ok || !payload?.repairs) return out;
    for (const fix of payload.repairs) {
      if (Number.isInteger(fix.index)) out.set(fix.index, typeof fix.code === "string" ? fix.code : null);
    }
  } catch {
    return out;
  }
  return out;
}

function chooseQuality(plan: Plan, results: Map<number, ProbeResult>): { fps: 12 | 24; width: number } {
  let perSecond = 0;
  plan.scenes.forEach((scene, index) => {
    const ms = results.get(index)?.ms ?? 20;
    perSecond += (ms / 1000) * scene.seconds;
  });
  if (perSecond * 24 <= RENDER_BUDGET_SECONDS) return { fps: 24, width: 1920 };
  if (perSecond * 12 <= RENDER_BUDGET_SECONDS) return { fps: 12, width: 1920 };
  return { fps: 12, width: 1280 };
}

/**
 * Load the scenes, check each one (errors, blank frames, slow frames), ask the writer to fix
 * the failures once, and return an engine ready to film. Scenes that still fail fall back to
 * the runtime's title card for that scene.
 */
export async function directFilm(options: {
  topic: string;
  plan: Plan;
  codes: (string | null)[];
  serverErrors: (string | undefined)[];
  onStatus: (status: DirectorStatus) => void;
  isCancelled: () => boolean;
}): Promise<Directed | null> {
  const { topic, plan, onStatus, isCancelled } = options;
  const codes = options.codes.slice();
  const total = plan.scenes.length;
  const all = plan.scenes.map((_, index) => index);

  let engine = await FilmEngine.create(codes, filmEngineConfig(plan, 24, 1920));
  const runnable = all.filter((index) => codes[index]);
  const results = await probeAll(engine, runnable, onStatus, total, () => isCancelled());
  if (isCancelled()) {
    engine.dispose();
    return null;
  }

  const failures = all
    .map((index) => {
      if (!codes[index]) {
        return { index, code: null, error: options.serverErrors[index] ?? "The scene did not come back." };
      }
      const result = results.get(index);
      const issue = result ? problem(result) : null;
      return issue ? { index, code: codes[index] ?? null, error: issue } : null;
    })
    .filter((item): item is { index: number; code: string | null; error: string } => item !== null);

  if (failures.length) {
    console.warn(
      "[explain-video] repairing",
      failures.map((failure) => `${failure.index + 1}: ${failure.error}`).join(" | "),
    );
    onStatus({ kind: "repairing", count: failures.length });
    const fixes = await requestRepairs(topic, plan, failures);
    if (isCancelled()) {
      engine.dispose();
      return null;
    }
    const retried: number[] = [];
    for (const failure of failures) {
      const fixed = fixes.get(failure.index);
      codes[failure.index] = fixed ?? null;
      if (fixed) retried.push(failure.index);
    }
    engine.dispose();
    engine = await FilmEngine.create(codes, filmEngineConfig(plan, 24, 1920));
    const second = await probeAll(engine, retried, onStatus, total, () => isCancelled());
    if (isCancelled()) {
      engine.dispose();
      return null;
    }
    let dropped = false;
    for (const index of retried) {
      const result = second.get(index);
      const issue = result ? problem(result) : "The scene was not checked.";
      if (issue) {
        console.warn("[explain-video] scene falls back", index + 1, issue);
        codes[index] = null;
        results.delete(index);
        dropped = true;
      } else if (result) {
        results.set(index, result);
      }
    }
    for (const failure of failures) {
      if (!retried.includes(failure.index)) results.delete(failure.index);
    }
    if (dropped) {
      engine.dispose();
      engine = await FilmEngine.create(codes, filmEngineConfig(plan, 24, 1920));
    }
  }

  const quality = chooseQuality(plan, results);
  if (quality.fps !== 24 || quality.width !== 1920) {
    engine.dispose();
    engine = await FilmEngine.create(codes, filmEngineConfig(plan, quality.fps, quality.width));
  }

  return {
    engine,
    codes,
    fallbacks: all.filter((index) => !codes[index]),
    fps: quality.fps,
    width: quality.width,
  };
}
