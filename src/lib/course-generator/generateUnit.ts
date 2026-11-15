import { z } from "zod";
import { digestFromContent, formatPriorBlock } from "@/lib/course-generator/context";
import {
  QuestionsContentSchema,
  WritingContentSchema,
  type CourseUnit,
  type CourseUnitContent,
  type PriorUnitDigest,
} from "@/lib/course-generator/types";
import { lessonMcqSchema } from "@/lib/schemas/mcq";
import { completeJson } from "@/lib/voice-tutor/brain";
import { VoiceLessonPlanSchema } from "@/lib/voice-tutor/sessionTypes";
import { generateWhiteboard } from "@/lib/voice-tutor/whiteboard/generate";

const PlanDraftSchema = z.object({
  topic: z.string(),
  label: z.string(),
  objective: z.string(),
  beats: z
    .array(
      z.object({
        id: z.string().optional(),
        say: z.string().min(1),
        expectAnswer: z.boolean().optional(),
        board: z
          .object({
            sectionLabel: z.string().optional(),
            formalStatement: z.string().optional(),
            plainExplain: z.string().optional(),
            keyPoints: z.array(z.string()).optional(),
          })
          .optional(),
      }),
    )
    .min(3)
    .max(8),
});

const WHITEBOARD_SYSTEM = `You write a short whiteboard lesson plan for one course unit.

Return JSON:
{
  "topic": string,
  "label": string,
  "objective": string,
  "beats": [
    {
      "id": "b1",
      "say": "what the tutor says aloud (1-2 sentences)",
      "expectAnswer": false,
      "board": {
        "sectionLabel": "Definition|Key concepts|Example",
        "formalStatement": "optional short formal line",
        "plainExplain": "optional plain meaning",
        "keyPoints": ["short bullet", "…"]
      }
    }
  ]
}

Rules:
- 4 to 6 beats: definition → concepts → example. At most one expectAnswer beat at the end.
- Speak casually and clearly. No markdown.
- Use PRIOR UNITS so you continue the course — don't re-teach everything from scratch; build on what was covered.
- JSON only.`;

const WRITING_SYSTEM = `You write study notes for one course unit.

Return JSON:
{
  "title": string,
  "intro": "2-3 sentences",
  "sections": [{ "heading": string, "body": "1-3 short paragraphs" }],
  "takeaways": ["bullet", "…"]
}

Rules:
- 3 to 5 sections. Clear headings. Body is plain prose, no markdown fences.
- Build on PRIOR UNITS — reference ideas already taught; deepen or organize them.
- takeaways: 3 to 5 short bullets.
- JSON only.`;

const QUESTIONS_SYSTEM = `You write practice multiple-choice questions for one course unit.

Return JSON:
{
  "intro": "one short line",
  "items": [
    {
      "question": string,
      "options": ["A","B","C","D"],
      "correctIndex": 0,
      "explanation": "why the answer is right"
    }
  ]
}

Rules:
- 3 to 5 items. Exactly 4 options each. correctIndex 0-3.
- Questions must test what PRIOR UNITS + this unit's objective cover.
- JSON only.`;

function coercePlan(raw: z.infer<typeof PlanDraftSchema>) {
  const beats = raw.beats.map((b, i) => ({
    id: b.id?.trim() || `b${i + 1}`,
    say: b.say.trim(),
    expectAnswer: Boolean(b.expectAnswer),
    rubricKeywords: [] as string[],
    board: b.board
      ? {
          sectionLabel: b.board.sectionLabel,
          formalStatement: b.board.formalStatement,
          plainExplain: b.board.plainExplain,
          keyPoints: b.board.keyPoints ?? [],
        }
      : { keyPoints: [] as string[] },
  }));
  return VoiceLessonPlanSchema.parse({
    topic: raw.topic,
    label: raw.label,
    objective: raw.objective,
    beats,
  });
}

async function generateWhiteboardUnit(input: {
  courseTitle: string;
  courseTopic: string;
  unit: CourseUnit;
  priors: PriorUnitDigest[];
}): Promise<CourseUnitContent> {
  const raw = await completeJson({
    system: WHITEBOARD_SYSTEM,
    user: [
      `Course: ${input.courseTitle}`,
      `Overall topic: ${input.courseTopic}`,
      `This unit: ${input.unit.title}`,
      `Unit objective: ${input.unit.objective}`,
      ``,
      `PRIOR UNITS:`,
      formatPriorBlock(input.priors),
    ].join("\n"),
    temperature: 0.4,
  });
  const draft = PlanDraftSchema.parse(raw);
  const plan = coercePlan(draft);
  const whiteboard = await generateWhiteboard(plan, "default");
  return { kind: "whiteboard", data: { plan, whiteboard } };
}

async function generateWritingUnit(input: {
  courseTitle: string;
  courseTopic: string;
  unit: CourseUnit;
  priors: PriorUnitDigest[];
}): Promise<CourseUnitContent> {
  const raw = await completeJson({
    system: WRITING_SYSTEM,
    user: [
      `Course: ${input.courseTitle}`,
      `Overall topic: ${input.courseTopic}`,
      `This unit: ${input.unit.title}`,
      `Unit objective: ${input.unit.objective}`,
      ``,
      `PRIOR UNITS (notes must build on these):`,
      formatPriorBlock(input.priors),
    ].join("\n"),
    temperature: 0.4,
  });
  const data = WritingContentSchema.parse(raw);
  return { kind: "writing", data };
}

async function generateQuestionsUnit(input: {
  courseTitle: string;
  courseTopic: string;
  unit: CourseUnit;
  priors: PriorUnitDigest[];
}): Promise<CourseUnitContent> {
  const raw = await completeJson({
    system: QUESTIONS_SYSTEM,
    user: [
      `Course: ${input.courseTitle}`,
      `Overall topic: ${input.courseTopic}`,
      `This unit: ${input.unit.title}`,
      `Unit objective: ${input.unit.objective}`,
      ``,
      `PRIOR UNITS (questions must check these):`,
      formatPriorBlock(input.priors),
    ].join("\n"),
    temperature: 0.5,
  });
  const loose = z
    .object({
      intro: z.string().optional(),
      items: z.array(z.unknown()).min(2).max(6),
    })
    .parse(raw);
  const items = loose.items
    .map((item) => lessonMcqSchema.safeParse(item))
    .filter((r) => r.success)
    .map((r) => r.data);
  const data = QuestionsContentSchema.parse({
    intro: loose.intro,
    items: items.slice(0, 5),
  });
  return { kind: "questions", data };
}

export type GeneratedUnit = {
  content: CourseUnitContent;
  summary: string;
};

/** Lazily generate one course unit, conditioned on prior digests. */
export async function generateCourseUnit(input: {
  courseTitle: string;
  courseTopic: string;
  unit: CourseUnit;
  priors: PriorUnitDigest[];
}): Promise<GeneratedUnit> {
  let content: CourseUnitContent;
  if (input.unit.kind === "whiteboard") {
    content = await generateWhiteboardUnit(input);
  } else if (input.unit.kind === "writing") {
    content = await generateWritingUnit(input);
  } else {
    content = await generateQuestionsUnit(input);
  }
  return {
    content,
    summary: digestFromContent(input.unit, content).slice(0, 900),
  };
}
