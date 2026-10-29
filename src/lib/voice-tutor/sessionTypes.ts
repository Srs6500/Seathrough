import { z } from "zod";

/** High-level Voice Tutor session phases (app-owned). */
export const VoicePhaseSchema = z.enum([
  "permission",
  "idle",
  "greeting",
  "chatting",
  /** Broad topic heard — asking which angle / subtopic before teaching. */
  "clarify_focus",
  "topic_pending",
  "teaching",
  "checking",
  /** After a mid-lesson clarify aside — waiting for "hope that's clear?" reply. */
  "aside_confirm",
  /** After ~50% scaffold — offering the student a chance to try. */
  "check_offer_try",
  /** End-of-lesson parked doubts — incremental reveal with student tries. */
  "deferred_close",
  "ended",
]);

export type VoicePhase = z.infer<typeof VoicePhaseSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "tutor"]),
  text: z.string(),
  at: z.number(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const DrawSceneSchema = z.object({
  kind: z.enum([
    "svg_graph",
    "concept_boxes",
    /** Physics VFPt image — only when topic gate + score clear. */
    "vfpt_svg",
    /** Smart Tutor tldraw board (boxes → ExperimentShape via applyScene). */
    "tldraw_sketch",
    "none",
  ]),
  title: z.string().optional(),
  /**
   * Payload by kind:
   * - svg_graph: { scene: VisualScene }
   * - vfpt_svg: { url, filename, label }
   * - tldraw_sketch: { boxes: Array<{ id, label }> } drawn on real tldraw
   */
  spec: z.record(z.string(), z.unknown()).optional(),
  highlightIds: z.array(z.string()).default([]),
});

export type DrawScene = z.infer<typeof DrawSceneSchema>;

/** Precise apply-unit mark on the glass board (DOM-validated substring). */
export const BoardAnnotationSchema = z.object({
  id: z.string(),
  /** Exact contiguous substring of sourceText / stanza text. */
  targetPhrase: z.string().min(1),
  style: z.enum(["circle", "underline", "both"]).default("both"),
  /** How to remember / apply — shown as a tip chip. */
  sideNote: z.string().min(1),
  /** Optional spoken/written recall prompt. */
  recallQuestion: z.string().optional(),
  /** Optional exam-style phrasing. */
  examCue: z.string().optional(),
});

export type BoardAnnotation = z.infer<typeof BoardAnnotationSchema>;

/** Glass-board pedagogy rendered beside voice (not spoken as UI meta). */
export const BoardContentSchema = z.object({
  formalStatement: z.string().optional(),
  sourceTitle: z.string().optional(),
  sourceText: z.string().optional(),
  /** Section on the board: Definition, Key concepts, Example. */
  sectionLabel: z.string().optional(),
  /** 2–3 very short sentences: what the passage actually means. */
  plainExplain: z.string().optional(),
  /** Substring in sourceText to highlighter-sweep (legacy single mark). */
  highlight: z.string().optional(),
  /** Short “way to remember” / exam cue drawn off the highlight. */
  rememberTip: z.string().optional(),
  /** Optional exam-style question framing for the highlight. */
  examCue: z.string().optional(),
  /** How to point at the highlight after it is marked. */
  pointer: z.enum(["circle", "arrow", "both"]).optional(),
  keyPoints: z.array(z.string()).default([]),
  /**
   * Precise apply-units (preferred). Missing/invalid phrases are dropped
   * before render — never circle the wrong span.
   */
  annotations: z.array(BoardAnnotationSchema).max(4).optional(),
});

export type BoardContent = z.infer<typeof BoardContentSchema>;

export const TeachBeatSchema = z.object({
  id: z.string(),
  say: z.string().min(1),
  /** Diagram / scene for the glass board. */
  draw: DrawSceneSchema.optional(),
  /** Grounded passage + bullets for the glass board. */
  board: BoardContentSchema.optional(),
  expectAnswer: z.boolean().default(false),
  rubricKeywords: z.array(z.string()).default([]),
  hintSay: z.string().optional(),
  successSay: z.string().optional(),
});

export type TeachBeat = z.infer<typeof TeachBeatSchema>;

/** Web page the lesson was researched from (hover a sentence to see it). */
export const LessonSourceRefSchema = z.object({
  title: z.string(),
  url: z.string(),
  publisher: z.string(),
  excerpt: z.string().optional(),
});

export type LessonSourceRef = z.infer<typeof LessonSourceRefSchema>;

export const VoiceLessonPlanSchema = z.object({
  topic: z.string(),
  label: z.string(),
  objective: z.string(),
  beats: z.array(TeachBeatSchema).min(1).max(12),
  sources: z.array(LessonSourceRefSchema).optional(),
});

export type VoiceLessonPlan = z.infer<typeof VoiceLessonPlanSchema>;

export const TurnActionSchema = z.enum([
  "speak",
  /** Broad topic — ask which focus before teaching starts. */
  "clarify_focus",
  "propose_topic",
  "begin_teaching",
  "ask",
  "complete",
  /** Spoken redirect; do not put this line on the lesson board. */
  "redirect",
]);

export const TurnResponseSchema = z.object({
  say: z.string(),
  action: TurnActionSchema,
  topic: z.string().optional(),
  label: z.string().optional(),
  /** Broad parent topic while clarifying focus (e.g. "cooking"). */
  parentTopic: z.string().optional(),
  /** 2–4 spoken focus options for clarify_focus. */
  focusOptions: z.array(z.string()).max(6).optional(),
  /** Legacy; teaching starts immediately after a focus is confirmed. */
  lockSeconds: z.number().int().positive().optional(),
  plan: VoiceLessonPlanSchema.optional(),
  /** If false, speak only — lesson canvas stays on pedagogy. Default true for teaching beats. */
  showOnBoard: z.boolean().optional(),
  /** Short written clarify note for the board (mid-lesson aside). */
  boardNote: z.string().optional(),
  /**
   * End-of-lesson parked-doubt scaffold (voice drips these across student tries).
   * piece1 ≈ 25%, piece2 ≈ next 25%, full = complete close-out.
   */
  deferredPieces: z
    .object({
      piece1: z.string(),
      piece2: z.string(),
      full: z.string(),
    })
    .optional(),
});

/** What the Units-style lesson canvas renders (not a chat log). */
export type LessonFrame = {
  visualTitle?: string;
  /** Short section blocks like Units "Today's focus" */
  sections: Array<{ heading: string; body: string }>;
  equation?: string;
  board: BoardContent | null;
  draw: DrawScene | null;
};

export type TurnResponse = z.infer<typeof TurnResponseSchema>;

export type HistorySession = {
  id: string;
  label: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  objective?: string;
  ended: boolean;
};
