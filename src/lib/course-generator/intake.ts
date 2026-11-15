import { completeJson } from "@/lib/voice-tutor/brain";
import {
  IntakeQuestionSchema,
  type IntakeQuestion,
} from "@/lib/course-generator/types";
import { z } from "zod";

const SYSTEM = `You write a short intake questionnaire for a custom learning course.

The learner already described what they want to learn. Ask 3–5 clarifying questions so we can design the right course outline.

Return JSON:
{
  "questions": [
    {
      "id": "q1",
      "prompt": "short question",
      "options": ["chip A", "chip B", "chip C"],
      "allowMultiple": false
    }
  ]
}

Rules:
- 3 to 5 questions.
- Cover: experience level, goals, what to include/skip, preferred depth or pace, any must-cover topics.
- Prefer chip options (3–5) when choices are clear. Use empty options [] only for free-text when needed.
- allowMultiple true only when several selections make sense (e.g. topics to include).
- ids: q1, q2, …
- Keep prompts under 90 characters. Options under 40 characters.
- JSON only.`;

const ResponseSchema = z.object({
  questions: z.array(IntakeQuestionSchema).min(3).max(5),
});

function fallbackQuestions(topic: string): IntakeQuestion[] {
  return [
    {
      id: "q1",
      prompt: `What's your level with ${topic.slice(0, 40)}?`,
      options: ["Beginner", "Some experience", "Advanced"],
      allowMultiple: false,
    },
    {
      id: "q2",
      prompt: "What do you want most from this course?",
      options: [
        "Clear foundations",
        "Worked examples",
        "Practice questions",
        "Exam prep",
      ],
      allowMultiple: true,
    },
    {
      id: "q3",
      prompt: "How deep should we go?",
      options: ["Quick overview", "Solid intermediate", "Deep dive"],
      allowMultiple: false,
    },
    {
      id: "q4",
      prompt: "Anything we should skip or emphasize?",
      options: [],
      allowMultiple: false,
    },
  ];
}

/** Clarifying questions for the intake card. */
export async function generateIntakeQuestions(
  topic: string,
): Promise<IntakeQuestion[]> {
  const trimmed = topic.trim().slice(0, 500);
  if (!trimmed) return fallbackQuestions("this topic");

  try {
    const raw = await completeJson({
      system: SYSTEM,
      user: `Learner request:\n${trimmed}`,
      temperature: 0.4,
    });
    const parsed = ResponseSchema.safeParse(raw);
    if (parsed.success) return parsed.data.questions;
  } catch (error) {
    console.warn("[course-generator/intake]", error);
  }
  return fallbackQuestions(trimmed);
}
