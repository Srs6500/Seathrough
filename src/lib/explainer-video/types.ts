/**
 * Explainer video: a 30-60 s narrated reel (vertical 1080x1920 or horizontal
 * 1920x1080) rendered locally with Kokoro → faster-whisper → HyperFrames → FFmpeg.
 */

import { z } from "zod";

export type Orientation = "vertical" | "horizontal";

export const DEMO_KINDS = ["flow", "compare", "stack", "cycle"] as const;
export type DemoKind = (typeof DEMO_KINDS)[number];

/** On-screen text: no full stops, no emoji (see the direction). */
const screenText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => cleanScreenText(value));

const spoken = z.string().trim().min(2).max(320);

export const pointSchema = z.object({
  /** Header label: "// 01 · name". */
  name: screenText(24),
  /** Two title words, both spoken in `line`. First ink, second red. */
  title: z.tuple([screenText(14), screenText(14)]),
  /** Spoken: introduces the point and says both title words. */
  line: spoken,
  /** Header stat + main card counter. */
  stat: z.object({
    value: z.number().int().min(1).max(9999),
    suffix: z.string().max(3).default(""),
    label: screenText(22),
  }),
  /** Main card caption under the counter. */
  card: screenText(40),
  /** One line typed in the terminal / search bar. */
  typed: screenText(30),
  bar: z.enum(["terminal", "search"]),
  /** Spoken explanation the demo acts out. */
  explanation: spoken,
  demo: z.object({
    kind: z.enum(DEMO_KINDS),
    items: z.array(screenText(18)).min(2).max(4),
    /** compare only: one 1-100 value per item. */
    values: z.array(z.number().min(1).max(100)).optional(),
  }),
  /** Stamp text, lands on `stampWord` (a word in `explanation`). */
  stamp: screenText(12),
  stampWord: z.string().trim().min(1).max(24),
});

export const scriptSchema = z.object({
  topic: screenText(60),
  /** Line 1: the problem in under 6 words. Line 2: the payoff promise. */
  hook: z.tuple([spoken, spoken]),
  /** UI card that line 1 strikes through. */
  problem: screenText(36),
  /** Small cards that pop in on line 2; the last one gets the red ring. */
  payoff: z.array(screenText(18)).min(2).max(3),
  /** Word in hook line 2 the ring draws on. */
  payoffWord: z.string().trim().min(1).max(24),
  points: z.array(pointSchema).min(3).max(7),
  /** Pays off the hook. */
  closing: spoken,
});

export type ExplainerPoint = z.infer<typeof pointSchema>;
export type ExplainerScript = z.infer<typeof scriptSchema>;

export const KOKORO_VOICES = [
  { id: "am_michael", label: "Michael", note: "American, warm" },
  { id: "af_heart", label: "Heart", note: "American, bright" },
  { id: "bm_george", label: "George", note: "British, steady" },
] as const;
export type VoiceId = (typeof KOKORO_VOICES)[number]["id"];

export type WordTiming = { word: string; start: number; end: number };

export type JobStage =
  | "queued"
  | "voice"
  | "timing"
  | "building"
  | "checking"
  | "snapshots"
  | "preview"
  | "rendering"
  | "mixing"
  | "done"
  | "error";

export type ExplainerJob = {
  id: string;
  createdAt: number;
  orientation: Orientation;
  voice: VoiceId;
  script: ExplainerScript;
  stage: JobStage;
  /** Human status line for the page. */
  detail: string;
  /** Duration of the final cut in seconds, once timed. */
  duration?: number;
  /** First frame of every point (published file names under the job). */
  snapshots?: Array<{ label: string; file: string }>;
  video?: string;
  error?: string;
};

/** Words spoken in order: hook, each point's line + explanation, closing. */
export function spokenLines(script: ExplainerScript): string[] {
  return [
    script.hook[0],
    script.hook[1],
    ...script.points.flatMap((p) => [p.line, p.explanation]),
    script.closing,
  ];
}

export function wordCount(script: ExplainerScript): number {
  return spokenLines(script).join(" ").split(/\s+/).filter(Boolean).length;
}

/** Roughly what Kokoro at speed 1.1 says per second after pause trimming. */
export const WORDS_PER_SECOND = 2.75;

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

export function cleanScreenText(value: string): string {
  return value.replace(EMOJI, "").replace(/\./g, "").replace(/\s+/g, " ").trim();
}
