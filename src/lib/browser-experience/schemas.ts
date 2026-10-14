import { z } from "zod";

export const annotationSchema = z.object({
  kind: z.enum([
    "highlight",
    "circle",
    "clear",
    "click",
    "youtube_play",
    "youtube_pause",
    "youtube_seek",
  ]),
  text: z.string().max(400).optional(),
  selector: z.string().max(300).optional(),
  label: z.string().max(160).optional(),
  seconds: z.number().min(0).max(60 * 60 * 6).optional(),
});

export const teachBeatSchema = z.object({
  id: z.string().min(1).max(40),
  speech: z.string().min(1).max(500),
  annotation: annotationSchema,
  holdMs: z.number().int().min(0).max(20_000).optional(),
  role: z.enum(["ground", "truth"]).optional(),
});

export const teachPlanSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(600),
  beats: z.array(teachBeatSchema).min(1).max(12),
});

export type TeachPlanParsed = z.infer<typeof teachPlanSchema>;

export const actQuestionSchema = z.object({
  id: z.string().min(1).max(40),
  prompt: z.string().min(1).max(400),
  choices: z.array(z.string().min(1).max(200)).min(2).max(4),
  answerIndex: z.number().int().min(0).max(3),
});

export const actPlanSchema = z.object({
  questions: z.array(actQuestionSchema).min(2).max(3),
});

export type ActPlanParsed = z.infer<typeof actPlanSchema>;

export const askBodySchema = z.object({
  prompt: z.string().min(1).max(800),
  sessionId: z.string().min(1).max(80).optional(),
});

export const followUpBodySchema = z.object({
  sessionId: z.string().min(1).max(80),
  prompt: z.string().min(1).max(800),
});

export const annotateBodySchema = z.object({
  sessionId: z.string().min(1).max(80),
  annotation: annotationSchema,
});

export const roleBodySchema = z.object({
  sessionId: z.string().min(1).max(80),
  role: z.enum(["ground", "truth"]),
});

export const tabBodySchema = z.object({
  sessionId: z.string().min(1).max(80),
  action: z.enum(["activate", "close", "new", "navigate", "reload"]),
  tabId: z.string().min(1).max(80).optional(),
  /** Omnibox value — URL or search query (action=navigate). */
  url: z.string().min(1).max(2000).optional(),
});

export const controlBodySchema = z.object({
  sessionId: z.string().min(1).max(80),
  action: z.enum(["take", "resume", "refresh_live"]),
  reason: z.string().max(300).optional(),
});

export const sessionBodySchema = z.object({
  sessionId: z.string().min(1).max(80).optional(),
});

/** In-app Take control: map clicks/keys onto the Playwright page. */
export const inputBodySchema = z.object({
  sessionId: z.string().min(1).max(80),
  type: z.enum(["click", "dblclick", "type", "key"]),
  /** Normalized 0–1 coords within the screenshot / viewport. */
  xNorm: z.number().min(0).max(1).optional(),
  yNorm: z.number().min(0).max(1).optional(),
  text: z.string().max(500).optional(),
  key: z.string().max(40).optional(),
});
