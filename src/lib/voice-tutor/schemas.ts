import { z } from "zod";

/** Relation edges between concept blocks (graph overlay on the lesson tree). */
export const ConceptRelationSchema = z.object({
  type: z.enum([
    "prerequisite",
    "applied_by",
    "compared_to",
    "causes",
    "part_of",
  ]),
  target: z.string().min(1),
});

export const SourceRefSchema = z.object({
  sourceId: z.string().min(1),
  passageId: z.string().min(1),
  title: z.string().min(1),
  /** Verbatim or carefully paraphrased grounded text. */
  text: z.string().min(1),
  /** Substring (or short span) to highlight while narrating. */
  highlight: z.string().min(1).optional(),
});

export const SceneObjectSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["circle", "line", "point", "curve", "label", "axis"]),
  /** Scene-local params interpreted by the renderer. */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const VisualSceneSchema = z.object({
  sceneId: z.string().min(1),
  title: z.string().min(1),
  coordinateSystem: z.enum(["cartesian", "none"]).default("cartesian"),
  objects: z.array(SceneObjectSchema).min(1),
  traceTask: z
    .object({
      targetId: z.string().min(1),
      interaction: z.enum(["follow_path", "inspect"]),
      prompt: z.string().min(1),
    })
    .optional(),
});

export const ConceptBlockSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["concept", "example", "assessment", "review"]),
  title: z.string().min(1),
  prerequisites: z.array(z.string()).default([]),
  relations: z.array(ConceptRelationSchema).default([]),
  sourceRefs: z.array(SourceRefSchema).default([]),
  lesson: z.object({
    formalStatement: z.string().min(1),
    keyPoints: z.array(z.string().min(1)).min(1).max(6),
    narration: z.string().min(1),
    socraticPrompts: z.array(z.string().min(1)).default([]),
  }),
  visual: z
    .object({
      sceneId: z.string().min(1),
      focusObjectIds: z.array(z.string()).default([]),
    })
    .optional(),
  assessment: z
    .object({
      rubricId: z.string().min(1),
      expectKeywords: z.array(z.string()).default([]),
      successSay: z.string().min(1),
      hintSay: z.string().min(1),
    })
    .optional(),
});

export const DisplayActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clear") }),
  z.object({
    type: z.literal("show_source"),
    sourceId: z.string(),
    passageId: z.string(),
  }),
  z.object({
    type: z.literal("highlight_source"),
    passageId: z.string(),
    highlight: z.string(),
  }),
  z.object({
    type: z.literal("show_keypoints"),
    blockId: z.string(),
  }),
  z.object({
    type: z.literal("show_scene"),
    sceneId: z.string(),
  }),
  z.object({
    type: z.literal("focus_objects"),
    sceneId: z.string(),
    objectIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("trace_start"),
    sceneId: z.string(),
    targetId: z.string(),
  }),
  z.object({
    type: z.literal("ask"),
    prompt: z.string(),
  }),
]);

export const LessonStepSchema = z.object({
  id: z.string().min(1),
  blockId: z.string().min(1),
  phase: z.enum([
    "introduce",
    "explain",
    "demonstrate",
    "guide",
    "scaffold",
    "practice",
    "assess",
    "complete",
  ]),
  speech: z.string().min(1),
  display: z.array(DisplayActionSchema).default([]),
  expectResponse: z
    .enum(["none", "spoken_reasoning", "trace"])
    .default("none"),
});

export const SlrLessonSchema = z.object({
  id: z.string().min(1),
  version: z.literal("1.0"),
  title: z.string().min(1),
  subject: z.string().min(1),
  objective: z.string().min(1),
  blocks: z.array(ConceptBlockSchema).min(1),
  scenes: z.array(VisualSceneSchema).default([]),
  /** Ordered instructional timeline — orchestrator walks this, not free LLM flow. */
  steps: z.array(LessonStepSchema).min(1),
});

export const LessonEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("lesson.loaded"),
    lessonId: z.string(),
    title: z.string(),
    objective: z.string(),
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    event: z.literal("lesson.step"),
    sessionId: z.string(),
    revision: z.number().int().nonnegative(),
    stepId: z.string(),
    blockId: z.string(),
    phase: LessonStepSchema.shape.phase,
    speech: z.object({ text: z.string() }),
    display: z.array(DisplayActionSchema),
    expectResponse: LessonStepSchema.shape.expectResponse,
  }),
  z.object({
    event: z.literal("lesson.waiting"),
    sessionId: z.string(),
    revision: z.number().int().nonnegative(),
    stepId: z.string(),
    prompt: z.string(),
  }),
  z.object({
    event: z.literal("lesson.feedback"),
    sessionId: z.string(),
    revision: z.number().int().nonnegative(),
    understood: z.boolean(),
    speech: z.object({ text: z.string() }),
  }),
  z.object({
    event: z.literal("lesson.complete"),
    sessionId: z.string(),
    revision: z.number().int().nonnegative(),
    summary: z.string(),
  }),
  z.object({
    event: z.literal("lesson.error"),
    message: z.string(),
  }),
]);

export type ConceptBlock = z.infer<typeof ConceptBlockSchema>;
export type VisualScene = z.infer<typeof VisualSceneSchema>;
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type DisplayAction = z.infer<typeof DisplayActionSchema>;
export type LessonStep = z.infer<typeof LessonStepSchema>;
export type SlrLesson = z.infer<typeof SlrLessonSchema>;
export type LessonEvent = z.infer<typeof LessonEventSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
