import { z } from "zod";

export const LOOKS = ["ink", "riso", "screen", "pencil", "blueprint", "sky", "chalkboard", "pastel"] as const;

export type Look = (typeof LOOKS)[number];

/** Palette preset each look starts from (core.js presets, plus skyDay and chalkboard from kit.js). */
export const LOOK_PALETTE: Record<Look, string> = {
  ink: "paperInk",
  riso: "risoPop",
  screen: "screenSea",
  pencil: "pencilMinimal",
  blueprint: "blueprintNight",
  sky: "skyDay",
  chalkboard: "chalkboard",
  pastel: "doodlePastel",
};

/** Colours the page uses around the film (plan card, hold screen) so they match the chosen look. */
export const LOOK_COLORS: Record<
  Look,
  { paper: string; ink: string; accent: string; mute: string }
> = {
  ink: { paper: "#f3e6cf", ink: "#1e1630", accent: "#c8473f", mute: "#6b5a4a" },
  riso: { paper: "#f0ece2", ink: "#22366b", accent: "#ff48b0", mute: "#5b6a8f" },
  screen: { paper: "#e8e6db", ink: "#1f1e2d", accent: "#0a5083", mute: "#5f6470" },
  pencil: { paper: "#f4efe4", ink: "#201f1b", accent: "#b0483a", mute: "#6d685c" },
  blueprint: { paper: "#0b0d1f", ink: "#e8ecff", accent: "#7fe7ff", mute: "#8d97c9" },
  sky: { paper: "#dcebf6", ink: "#14263d", accent: "#e8705a", mute: "#4f6b85" },
  chalkboard: { paper: "#1f3a30", ink: "#f1f3e6", accent: "#f4d35e", mute: "#9fb3a4" },
  pastel: { paper: "#efd2d1", ink: "#23202b", accent: "#e8505b", mute: "#6b6577" },
};

/** The app's own colours, for the screen shown before a film has a look. */
export const APP_COLORS = { paper: "#f4f7fb", ink: "#1a2b3c", accent: "#1b6ca8", mute: "#6a7d90" };

export const SCENE_SECONDS_MIN = 3;
export const SCENE_SECONDS_MAX = 10;
/** A five-scene explainer should land near a minute. */
export const FILM_SECONDS_MAX = 60;
export const TARGET_SCENES = 5;
export const TOPIC_MAX = 6000;
/** A narrated scene lasts as long as its voice line, up to this. */
export const VOICED_SECONDS_MAX = 20;
/** Seconds of picture before the narrator starts speaking in each scene. */
export const NARRATION_LEAD = 0.4;
const NARRATION_TAIL = 0.7;
export const SPEAK_MAX = 280;

const planSceneSchema = z.object({
  title: z.string().min(1).max(48),
  seconds: z.number().min(SCENE_SECONDS_MIN).max(VOICED_SECONDS_MAX),
  see: z.string().min(1).max(320),
  say: z.string().min(1).max(110),
  speak: z.string().min(1).max(SPEAK_MAX),
});

export const planSchema = z.object({
  title: z.string().min(1).max(60),
  look: z.enum(LOOKS),
  angle: z.string().min(1).max(200),
  scenes: z.array(planSceneSchema).min(3).max(7),
});

export type PlanScene = z.infer<typeof planSceneSchema>;
export type Plan = z.infer<typeof planSchema>;

export const sceneCodeResponseSchema = z.object({
  scenes: z.array(
    z.object({
      code: z.string().nullable(),
      error: z.string().optional(),
    }),
  ),
});

export type SceneCodeResponse = z.infer<typeof sceneCodeResponseSchema>;

export const INCOMPLETE_PLAN = "The film plan came back incomplete. Try a clearer topic.";
export const INCOMPLETE_DRAWINGS = "The film could not be drawn. Try again in a moment.";

export function planDuration(plan: Plan): number {
  return plan.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
}

/**
 * Stretch or shrink each scene to fit its narration: a short lead-in, the line, then a beat.
 * Scenes without a voice line (null) keep their planned length.
 */
export function retimeToVoice(plan: Plan, voiceSeconds: (number | null)[]): Plan {
  return {
    ...plan,
    scenes: plan.scenes.map((scene, index) => {
      const voice = voiceSeconds[index];
      if (voice === null || voice === undefined || !Number.isFinite(voice) || voice <= 0) return scene;
      const wanted = NARRATION_LEAD + voice + NARRATION_TAIL;
      const seconds = Math.min(VOICED_SECONDS_MAX, Math.max(SCENE_SECONDS_MIN, wanted));
      return { ...scene, seconds: Math.round(seconds * 10) / 10 };
    }),
  };
}

/** Where each scene starts, in seconds from the top of the film. */
export function sceneStarts(plan: Plan): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const scene of plan.scenes) {
    starts.push(at);
    at += scene.seconds;
  }
  return starts;
}

/** Which scene is on screen at `seconds` into the film. */
export function sceneIndexAt(plan: Plan, seconds: number): number {
  let remaining = Math.max(0, seconds);
  for (let index = 0; index < plan.scenes.length; index += 1) {
    const duration = plan.scenes[index]!.seconds;
    if (remaining < duration || index === plan.scenes.length - 1) return index;
    remaining -= duration;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function clean(value: string): string {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clip(value: unknown, max: number, fallback = ""): string {
  const text = clean(typeof value === "string" ? value : "");
  const base = text || fallback;
  if (!base) return "";
  if (base.length <= max) return base;
  const sliced = base.slice(0, max - 1);
  const cut = sliced.lastIndexOf(" ");
  const body = (cut > max * 0.55 ? sliced.slice(0, cut) : sliced).trimEnd();
  return `${body}…`;
}

function seconds(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return 6;
  return Math.min(SCENE_SECONDS_MAX, Math.max(SCENE_SECONDS_MIN, numeric));
}

function lookFrom(value: unknown): Look {
  const raw = String(value ?? "").toLowerCase().trim();
  if ((LOOKS as readonly string[]).includes(raw)) return raw as Look;
  if (/chalkboard|blackboard|green ?board|classroom/.test(raw)) return "chalkboard";
  if (/blueprint|chalk|night|space|navy/.test(raw)) return "blueprint";
  if (/sky|daylight|light blue/.test(raw)) return "sky";
  if (/pastel|pink|doodle|watercolou?r/.test(raw)) return "pastel";
  if (/riso|halftone/.test(raw)) return "riso";
  if (/screen|flat/.test(raw)) return "screen";
  if (/pencil|graphite|sketch/.test(raw)) return "pencil";
  return "ink";
}

function coerceScene(value: unknown): PlanScene | null {
  const row = asRecord(value);
  const title = clip(row.title ?? row.name ?? row.heading, 48);
  const see = clip(
    row.see ?? row.visual ?? row.picture ?? row.drawing ?? row.shows ?? row.description,
    320,
  );
  const say = clip(
    row.say ?? row.caption ?? row.text ?? row.line ?? row.narration,
    110,
  );
  if (!title || !see) return null;
  const speak = clip(row.speak ?? row.voice ?? row.voiceover ?? row.narration ?? row.spoken, SPEAK_MAX);
  return {
    title,
    seconds: seconds(row.seconds ?? row.duration ?? row.dur),
    see,
    say: say || title,
    speak: speak || say || title,
  };
}

/** Drop extra scenes so the outline stays a five-beat story. */
export function trimToTargetScenes(plan: Plan): Plan {
  if (plan.scenes.length <= TARGET_SCENES) return plan;
  return { ...plan, scenes: plan.scenes.slice(0, TARGET_SCENES) };
}

/** Keep the whole film under FILM_SECONDS_MAX by shrinking every scene evenly. */
function fitDuration(scenes: PlanScene[]): PlanScene[] {
  const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  if (total <= FILM_SECONDS_MAX) {
    return scenes.map((scene) => ({ ...scene, seconds: Math.round(scene.seconds * 10) / 10 }));
  }
  const scale = FILM_SECONDS_MAX / total;
  return scenes.map((scene) => ({
    ...scene,
    seconds: Math.max(SCENE_SECONDS_MIN, Math.floor(scene.seconds * scale * 10) / 10),
  }));
}

/** Repair a model payload into a plan the film engine can shoot. */
export function coercePlan(raw: unknown): Plan {
  const root = asRecord(raw);
  const nested = asRecord(root.plan);
  const obj = Array.isArray(nested.scenes) ? { ...root, ...nested } : root;

  const incoming = Array.isArray(obj.scenes)
    ? obj.scenes
    : Array.isArray(obj.shots)
      ? obj.shots
      : [];
  const scenes = fitDuration(
    incoming
      .map((item) => coerceScene(item))
      .filter((item): item is PlanScene => item !== null)
      .slice(0, 7),
  );

  if (scenes.length < 3) {
    console.error(
      "[explain-video] thin plan",
      scenes.length,
      JSON.stringify(incoming[0] ?? obj).slice(0, 400),
    );
    throw new Error(INCOMPLETE_PLAN);
  }

  const title = clip(obj.title ?? root.title, 60, scenes[0]!.title);
  const parsed = planSchema.safeParse({
    title,
    look: lookFrom(obj.look ?? obj.style),
    angle: clip(obj.angle ?? obj.approach ?? obj.thesis, 200, scenes[0]!.say),
    scenes,
  });
  if (!parsed.success) {
    console.error(
      "[explain-video] plan schema",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" | "),
    );
    throw new Error(INCOMPLETE_PLAN);
  }
  return parsed.data;
}
