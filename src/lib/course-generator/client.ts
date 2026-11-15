import type {
  CourseOutline,
  CourseUnitContent,
  IntakeAnswer,
  IntakeQuestion,
} from "@/lib/course-generator/types";

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  try {
    return (await res.json()) as T & { error?: string };
  } catch {
    throw new Error("Couldn't read the server response.");
  }
}

export async function requestCourseIntake(
  topic: string,
  signal?: AbortSignal,
): Promise<IntakeQuestion[]> {
  const res = await fetch("/api/course-generator/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
    signal,
  });
  const body = await readJson<{ questions?: IntakeQuestion[] }>(res);
  if (!res.ok || !body.questions?.length) {
    throw new Error(body.error || "Couldn't build intake questions.");
  }
  return body.questions;
}

export async function requestCourseOutline(input: {
  topic: string;
  answers: IntakeAnswer[];
  signal?: AbortSignal;
}): Promise<CourseOutline> {
  const res = await fetch("/api/course-generator/outline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: input.topic, answers: input.answers }),
    signal: input.signal,
  });
  const body = await readJson<{ course?: CourseOutline }>(res);
  if (!res.ok || !body.course) {
    throw new Error(body.error || "Couldn't create the course outline.");
  }
  return body.course;
}

export async function requestGenerateCourseUnit(input: {
  course: CourseOutline;
  unitId: string;
  signal?: AbortSignal;
}): Promise<{
  content: CourseUnitContent;
  summary: string;
}> {
  const res = await fetch("/api/course-generator/generate-unit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      course: input.course,
      unitId: input.unitId,
    }),
    signal: input.signal,
  });
  const body = await readJson<{
    content?: CourseUnitContent;
    summary?: string;
  }>(res);
  if (!res.ok || !body.content || !body.summary) {
    throw new Error(body.error || "Couldn't generate that unit.");
  }
  return { content: body.content, summary: body.summary };
}
