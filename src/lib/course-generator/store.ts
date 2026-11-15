import {
  CourseOutlineSchema,
  type CourseOutline,
} from "@/lib/course-generator/types";

const KEY = "seethrough.course-generator.v1";

export function loadSavedCourses(): CourseOutline[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => CourseOutlineSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => r.data)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12);
  } catch {
    return [];
  }
}

export function saveCourse(course: CourseOutline): void {
  if (typeof window === "undefined") return;
  const next = [
    course,
    ...loadSavedCourses().filter((c) => c.id !== course.id),
  ].slice(0, 12);
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

export function deleteSavedCourse(id: string): void {
  if (typeof window === "undefined") return;
  const next = loadSavedCourses().filter((c) => c.id !== id);
  window.localStorage.setItem(KEY, JSON.stringify(next));
}
