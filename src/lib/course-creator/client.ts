import type { LessonScript } from "@/lib/course-creator/script";

const WRITE_FAILED = "The script could not be written. Try again in a moment.";

export async function requestLessonScript(
  prompt: string,
  signal?: AbortSignal,
): Promise<LessonScript> {
  let response: Response;
  try {
    response = await fetch("/api/course-creator/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("The script could not be written. Check your connection and try again.");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : WRITE_FAILED;
    throw new Error(message);
  }
  return payload as LessonScript;
}
