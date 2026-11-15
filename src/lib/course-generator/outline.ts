import { completeJson } from "@/lib/voice-tutor/brain";
import {
  CourseOutlineSchema,
  CourseUnitKindSchema,
  type CourseOutline,
  type IntakeAnswer,
} from "@/lib/course-generator/types";
import { z } from "zod";

const DraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  level: z.string().optional(),
  units: z
    .array(
      z.object({
        kind: CourseUnitKindSchema,
        title: z.string().min(1),
        objective: z.string().min(1),
      }),
    )
    .min(3)
    .max(10),
});

const SYSTEM = `You design a short custom course outline for SeeThrough.

The course is a sequence of units. Each unit is ONE of:
- "whiteboard" — spoken lesson that draws on a whiteboard
- "writing" — written notes / study sheet
- "questions" — practice MCQs that check understanding

Return JSON:
{
  "title": "course title",
  "description": "1-2 sentences",
  "level": "beginner|intermediate|advanced",
  "units": [
    { "kind": "whiteboard", "title": "…", "objective": "…" }
  ]
}

Rules:
- 4 to 8 units.
- Mix kinds: start with whiteboard teaching, include writing notes, include questions. Typical arc: teach → notes → teach → questions (adjust to the topic).
- Titles under 48 characters. Objectives under 120 characters.
- Do NOT write the lesson content — outline only.
- Match the learner's level and intake answers.
- JSON only.`;

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatAnswers(answers: IntakeAnswer[]): string {
  if (!answers.length) return "(none)";
  return answers
    .map((a) => `- ${a.questionId}: ${a.values.join(", ")}`)
    .join("\n");
}

function fallbackOutline(topic: string, answers: IntakeAnswer[]): CourseOutline {
  const now = Date.now();
  const label = topic.trim().slice(0, 60) || "Your topic";
  const units = [
    {
      id: newId("u"),
      order: 0,
      kind: "whiteboard" as const,
      title: `Start with ${label}`,
      objective: `Build a clear mental model of ${label}.`,
      status: "pending" as const,
    },
    {
      id: newId("u"),
      order: 1,
      kind: "writing" as const,
      title: "Core notes",
      objective: "Capture the key ideas in writing.",
      status: "pending" as const,
    },
    {
      id: newId("u"),
      order: 2,
      kind: "whiteboard" as const,
      title: "Worked example",
      objective: "Walk through one concrete example.",
      status: "pending" as const,
    },
    {
      id: newId("u"),
      order: 3,
      kind: "questions" as const,
      title: "Check yourself",
      objective: "Practice what you learned so far.",
      status: "pending" as const,
    },
  ];
  return CourseOutlineSchema.parse({
    id: newId("course"),
    title: `Learn ${label}`,
    description: `A short course on ${label}, shaped by your answers.`,
    topic: label,
    level: answers.find((a) => /level|beginner|experience/i.test(a.values.join(" ")))
      ?.values[0],
    createdAt: now,
    updatedAt: now,
    intakeAnswers: answers,
    units,
  });
}

/** Build a course outline from the topic + intake answers (no unit content yet). */
export async function generateCourseOutline(input: {
  topic: string;
  answers: IntakeAnswer[];
}): Promise<CourseOutline> {
  const topic = input.topic.trim().slice(0, 500);
  if (!topic) throw new Error("Enter what you want to learn");

  try {
    const raw = await completeJson({
      system: SYSTEM,
      user: `Learner request:\n${topic}\n\nIntake answers:\n${formatAnswers(input.answers)}`,
      temperature: 0.45,
    });
    const draft = DraftSchema.safeParse(raw);
    if (!draft.success) return fallbackOutline(topic, input.answers);

    const now = Date.now();
    return CourseOutlineSchema.parse({
      id: newId("course"),
      title: draft.data.title.slice(0, 80),
      description: draft.data.description.slice(0, 280),
      topic,
      level: draft.data.level,
      createdAt: now,
      updatedAt: now,
      intakeAnswers: input.answers,
      units: draft.data.units.map((u, order) => ({
        id: newId("u"),
        order,
        kind: u.kind,
        title: u.title.slice(0, 80),
        objective: u.objective.slice(0, 160),
        status: "pending" as const,
      })),
    });
  } catch (error) {
    console.warn("[course-generator/outline]", error);
    return fallbackOutline(topic, input.answers);
  }
}
