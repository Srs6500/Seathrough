import { FUNCTIONS_LESSON } from "@/lib/voice-tutor/lessons/functions";
import { SlrLessonSchema, type SlrLesson } from "@/lib/voice-tutor/schemas";

const LESSONS: Record<string, SlrLesson> = {
  [FUNCTIONS_LESSON.id]: FUNCTIONS_LESSON,
};

export const DEFAULT_VOICE_TUTOR_LESSON_ID = FUNCTIONS_LESSON.id;

export function listVoiceTutorLessons(): Array<{
  id: string;
  title: string;
  subject: string;
  objective: string;
}> {
  return Object.values(LESSONS).map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    subject: lesson.subject,
    objective: lesson.objective,
  }));
}

export function getVoiceTutorLesson(id: string): SlrLesson | null {
  const raw = LESSONS[id];
  if (!raw) return null;
  const parsed = SlrLessonSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[voice-tutor] invalid seed lesson", id, parsed.error);
    return null;
  }
  return parsed.data;
}

export function getDefaultVoiceTutorLesson(): SlrLesson {
  const lesson = getVoiceTutorLesson(DEFAULT_VOICE_TUTOR_LESSON_ID);
  if (!lesson) {
    throw new Error("Default Voice Tutor lesson failed validation.");
  }
  return lesson;
}
