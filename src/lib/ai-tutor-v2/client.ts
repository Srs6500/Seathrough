import type {
  InteractionCreated,
  InteractionKind,
  LearnerLevel,
  LessonCreated,
  LessonDetail,
  StreamEventEnvelope,
} from "@/lib/ai-tutor-v2/types";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      detail?: string;
    };
    if (body.error?.message) return body.error.message;
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // fall through
  }
  return `Request failed (${response.status}).`;
}

export async function createLesson(input: {
  question: string;
  level?: LearnerLevel;
  includeExample?: boolean;
}): Promise<LessonCreated> {
  const response = await fetch("/api/ai-tutor-v2/lessons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: input.question,
      learner: { level: input.level ?? "beginner", language: "en" },
      preferences: { include_example: Boolean(input.includeExample) },
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as LessonCreated;
}

export async function getLesson(lessonId: string): Promise<LessonDetail> {
  const response = await fetch(`/api/ai-tutor-v2/lessons/${lessonId}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as LessonDetail;
}

export async function submitInteraction(input: {
  lessonId: string;
  kind: InteractionKind;
  text?: string;
  currentVersionId?: string;
  currentBeatId?: string | null;
}): Promise<InteractionCreated> {
  const response = await fetch(
    `/api/ai-tutor-v2/lessons/${input.lessonId}/interactions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: input.kind,
        text: input.text,
        current_version_id: input.currentVersionId,
        current_beat_id: input.currentBeatId ?? undefined,
      }),
    },
  );
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as InteractionCreated;
}

export type StreamHandlers = {
  onEvent: (name: string, data: StreamEventEnvelope) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
};

/** Open the lesson SSE stream. Returns a closer. */
export function openLessonEvents(
  lessonId: string,
  handlers: StreamHandlers,
  options?: { lastEventId?: number },
): () => void {
  const url = new URL(
    `/api/ai-tutor-v2/lessons/${lessonId}/events`,
    window.location.origin,
  );
  if (options?.lastEventId != null) {
    url.searchParams.set("cursor", String(options.lastEventId));
  }
  const source = new EventSource(url.toString());
  const names = [
    "lesson.started",
    "lesson.plan",
    "beat.started",
    "narration.text",
    "board.action",
    "beat.completed",
    "lesson.paused",
    "lesson.resumed",
    "lesson.completed",
    "lesson.error",
    "lesson.cancelled",
  ];

  for (const name of names) {
    source.addEventListener(name, (event) => {
      const message = event as MessageEvent<string>;
      try {
        const data = JSON.parse(message.data) as StreamEventEnvelope;
        handlers.onEvent(name, data);
        if (
          name === "lesson.completed" ||
          name === "lesson.error" ||
          name === "lesson.cancelled"
        ) {
          source.close();
          handlers.onDone?.();
        }
      } catch {
        handlers.onError?.("Could not parse a lesson event.");
      }
    });
  }

  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) return;
    handlers.onError?.(
      "Lost the lesson stream. Is the AI Tutor v2 API running?",
    );
    source.close();
    handlers.onDone?.();
  };

  return () => source.close();
}
