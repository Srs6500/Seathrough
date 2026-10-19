import type { ExperimentLesson } from "@/lib/experiment/scene";

const TITLE_MAX = 60;

/** Client-safe helpers — no server env / fs imports. */

export function fallbackLessonTitle(lesson: ExperimentLesson): string {
  const fromTitle = lesson.title?.trim() ?? "";
  if (fromTitle && !/^explanation$/i.test(fromTitle)) {
    return clipTitle(fromTitle);
  }
  const fromQuestion = lesson.question?.trim() ?? "";
  if (fromQuestion) return clipTitle(fromQuestion);
  return "Saved lesson";
}

export function clipTitle(value: string): string {
  const cleaned = value
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Saved lesson";
  if (cleaned.length <= TITLE_MAX) return cleaned;
  const sliced = cleaned.slice(0, TITLE_MAX - 1);
  const cut = sliced.lastIndexOf(" ");
  return `${(cut > 24 ? sliced.slice(0, cut) : sliced).trim()}…`;
}
