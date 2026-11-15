import { z } from "zod";
import { lessonMcqSchema } from "@/lib/schemas/mcq";
import { VoiceLessonPlanSchema } from "@/lib/voice-tutor/sessionTypes";
import {
  WhiteboardSessionSchema,
  type WhiteboardSession,
} from "@/lib/voice-tutor/whiteboard/schema";
import type { VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";
import type { LessonMcq } from "@/lib/schemas/mcq";

/** Unit kinds in a generated course. */
export const CourseUnitKindSchema = z.enum([
  "whiteboard",
  "writing",
  "questions",
]);
export type CourseUnitKind = z.infer<typeof CourseUnitKindSchema>;

export const CourseUnitStatusSchema = z.enum([
  "pending",
  "generating",
  "ready",
  "error",
]);
export type CourseUnitStatus = z.infer<typeof CourseUnitStatusSchema>;

export const IntakeQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  /** Short chip choices; empty = free text. */
  options: z.array(z.string()).max(8).default([]),
  allowMultiple: z.boolean().default(false),
});
export type IntakeQuestion = z.infer<typeof IntakeQuestionSchema>;

export const IntakeAnswerSchema = z.object({
  questionId: z.string(),
  /** Selected options and/or free text. */
  values: z.array(z.string()).min(1),
});
export type IntakeAnswer = z.infer<typeof IntakeAnswerSchema>;

export const WritingSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
});
export type WritingSection = z.infer<typeof WritingSectionSchema>;

export const WritingContentSchema = z.object({
  title: z.string(),
  intro: z.string(),
  sections: z.array(WritingSectionSchema).min(1).max(8),
  takeaways: z.array(z.string()).max(6).default([]),
});
export type WritingContent = z.infer<typeof WritingContentSchema>;

export const QuestionsContentSchema = z.object({
  intro: z.string().optional(),
  items: z.array(lessonMcqSchema).min(2).max(6),
});
export type QuestionsContent = z.infer<typeof QuestionsContentSchema>;

export const WhiteboardContentSchema = z.object({
  plan: VoiceLessonPlanSchema,
  whiteboard: WhiteboardSessionSchema,
});
export type WhiteboardContent = {
  plan: VoiceLessonPlan;
  whiteboard: WhiteboardSession;
};

export const CourseUnitContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("whiteboard"), data: WhiteboardContentSchema }),
  z.object({ kind: z.literal("writing"), data: WritingContentSchema }),
  z.object({ kind: z.literal("questions"), data: QuestionsContentSchema }),
]);
export type CourseUnitContent =
  | { kind: "whiteboard"; data: WhiteboardContent }
  | { kind: "writing"; data: WritingContent }
  | { kind: "questions"; data: QuestionsContent };

export const CourseUnitSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  kind: CourseUnitKindSchema,
  title: z.string(),
  objective: z.string(),
  status: CourseUnitStatusSchema.default("pending"),
  error: z.string().optional(),
  /** Short digest after the learner finishes / content is ready. */
  summary: z.string().optional(),
  content: CourseUnitContentSchema.optional(),
});
export type CourseUnit = z.infer<typeof CourseUnitSchema>;

export const CourseOutlineSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  topic: z.string(),
  level: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  intakeAnswers: z.array(IntakeAnswerSchema).default([]),
  units: z.array(CourseUnitSchema).min(3).max(12),
});
export type CourseOutline = z.infer<typeof CourseOutlineSchema>;

export type PriorUnitDigest = {
  order: number;
  kind: CourseUnitKind;
  title: string;
  objective: string;
  summary: string;
};
