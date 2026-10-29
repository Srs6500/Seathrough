import { z } from "zod";

export const BEAT_SECONDS_MIN = 8;
export const BEAT_SECONDS_MAX = 50;
export const BEAT_COUNT_MIN = 4;
export const BEAT_COUNT_MAX = 12;
export const PROMPT_MAX = 800;

export const INCOMPLETE_SCRIPT =
  "The script came back incomplete. Try a clearer topic.";

const beatSchema = z.object({
  heading: z.string().min(1).max(60),
  seconds: z.number().min(BEAT_SECONDS_MIN).max(BEAT_SECONDS_MAX),
  visual: z.string().min(1).max(420),
  voiceover: z.string().min(1).max(520),
  onScreen: z.string().max(80).optional(),
});

export const lessonScriptSchema = z.object({
  title: z.string().min(1).max(80),
  hook: z.string().min(1).max(220),
  audience: z.string().min(1).max(80),
  runtimeSeconds: z.number().int().min(40).max(600),
  beats: z.array(beatSchema).min(BEAT_COUNT_MIN).max(BEAT_COUNT_MAX),
});

export type ScriptBeat = z.infer<typeof beatSchema>;
export type LessonScript = z.infer<typeof lessonScriptSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clip(value: unknown, max: number, fallback = ""): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function secondsOf(value: unknown): number {
  const n = asNumber(value);
  if (n == null) return 20;
  const rounded = Math.round(n);
  return Math.min(BEAT_SECONDS_MAX, Math.max(BEAT_SECONDS_MIN, rounded));
}

function coerceBeat(raw: unknown): ScriptBeat | null {
  const row = asRecord(raw);
  const heading = clip(
    row.heading ?? row.title ?? row.slug ?? row.name,
    60,
  );
  const visual = clip(
    row.visual ?? row.see ?? row.picture ?? row.shot,
    420,
  );
  const voiceover = clip(
    row.voiceover ??
      row.speak ??
      row.vo ??
      row.narration ??
      row.spoken ??
      row.say,
    520,
  );
  if (!heading || !visual || !voiceover) return null;
  const onScreen = clip(
    row.onScreen ?? row.on_screen ?? row.caption ?? row.lowerThird,
    80,
  );
  return {
    heading,
    seconds: secondsOf(row.seconds ?? row.duration ?? row.dur),
    visual,
    voiceover,
    ...(onScreen ? { onScreen } : {}),
  };
}

export function coerceLessonScript(raw: unknown): LessonScript {
  const root = asRecord(raw);
  const nested = asRecord(root.script ?? root.lesson ?? root.plan);
  const obj = Array.isArray(nested.beats) || Array.isArray(nested.scenes)
    ? { ...root, ...nested }
    : root;

  const incoming = Array.isArray(obj.beats)
    ? obj.beats
    : Array.isArray(obj.scenes)
      ? obj.scenes
      : Array.isArray(obj.shots)
        ? obj.shots
        : [];

  const beats = incoming
    .map((item) => coerceBeat(item))
    .filter((item): item is ScriptBeat => item !== null)
    .slice(0, BEAT_COUNT_MAX);

  if (beats.length < BEAT_COUNT_MIN) {
    throw new Error(INCOMPLETE_SCRIPT);
  }

  const runtimeSeconds = beats.reduce((sum, beat) => sum + beat.seconds, 0);
  const parsed = lessonScriptSchema.safeParse({
    title: clip(obj.title ?? root.title, 80, beats[0]!.heading),
    hook: clip(
      obj.hook ?? obj.logline ?? obj.angle ?? obj.promise,
      220,
      beats[0]!.voiceover,
    ),
    audience: clip(obj.audience ?? obj.level ?? obj.for, 80, "learners"),
    runtimeSeconds: Math.min(600, Math.max(40, runtimeSeconds)),
    beats,
  });
  if (!parsed.success) {
    throw new Error(INCOMPLETE_SCRIPT);
  }
  return parsed.data;
}

export function formatRuntime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `about ${minutes} min`;
}
