import type { ExperimentFollowup, ExperimentLesson } from "@/lib/experiment/scene";
import type { LessonAudioTap } from "@/components/experiment/screenRecorder";
import type {
  IntakeAnswers,
  SystemDesignIntake,
} from "@/lib/experiment/systemDesign/sections";
import type { SystemDesignRevision } from "@/lib/experiment/systemDesign/revise";
import type { SystemDesignSpec } from "@/lib/experiment/systemDesign/spec";

export type ExperimentDrawResult =
  | { kind: "lesson"; lesson: ExperimentLesson; spec?: SystemDesignSpec }
  | { kind: "intake"; intake: SystemDesignIntake };

let audioTap: LessonAudioTap | null = null;

export function setExperimentAudioTap(tap: LessonAudioTap | null) {
  audioTap = tap;
}

export async function requestExperimentLesson(
  prompt: string,
  signal?: AbortSignal,
  answers?: IntakeAnswers,
  kind: "tutor" | "system" | "physics" = "tutor",
): Promise<ExperimentDrawResult> {
  const res = await fetch("/api/experiment/draw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...(answers ? { answers } : {}),
      ...(kind === "system"
        ? { mode: "system" }
        : kind === "physics"
          ? { mode: "physics" }
          : {}),
    }),
    signal,
  });

  let body: {
    lesson?: ExperimentLesson;
    intake?: SystemDesignIntake;
    design?: { spec?: SystemDesignSpec };
    error?: string;
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new Error("Could not explain that. Try another question.");
  }

  if (!res.ok) {
    throw new Error(
      body.error || "Could not explain that. Try another question.",
    );
  }
  if (body.intake?.questions?.length && !answers) {
    return { kind: "intake", intake: body.intake };
  }
  if (!body.lesson?.beats?.length) {
    throw new Error(
      body.error || "Could not explain that. Try another question.",
    );
  }
  return {
    kind: "lesson",
    lesson: body.lesson,
    ...(body.design?.spec ? { spec: body.design.spec } : {}),
  };
}

export async function requestSystemDesignRevision(
  input: {
    prompt: string;
    answers: IntakeAnswers;
    spec: SystemDesignSpec;
    edits: string[];
    instruction: string;
  },
  signal?: AbortSignal,
): Promise<SystemDesignRevision> {
  const res = await fetch("/api/experiment/revise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  let body: { revision?: SystemDesignRevision; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new Error("Could not change the design. Try again.");
  }
  if (!res.ok || !body.revision) {
    throw new Error(body.error || "Could not change the design. Try again.");
  }
  const revision = body.revision;
  if (revision.kind === "revised" && !revision.lesson?.beats?.length) {
    throw new Error("Could not change the design. Try again.");
  }
  return revision;
}

export async function requestExperimentSpeak(
  text: string,
  signal?: AbortSignal,
  mode: "tutor" | "physics" = "tutor",
): Promise<{ mimeType: string; base64: string } | null> {
  const clipped = text.trim().slice(0, 900);
  if (!clipped) return null;
  const res = await fetch("/api/experiment/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: clipped,
      ...(mode === "physics" ? { mode: "physics" } : {}),
    }),
    signal,
  });
  if (res.status === 503) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as {
    mimeType?: string;
    base64?: string;
  };
  if (!body.base64) return null;
  return { mimeType: body.mimeType || "audio/mpeg", base64: body.base64 };
}

export async function requestExperimentListen(
  audio: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/experiment/listen", {
    method: "POST",
    headers: {
      "Content-Type": audio.type || "audio/webm",
    },
    body: audio,
    signal,
  });
  let body: { transcript?: string; error?: string } = {};
  try {
    body = (await res.json()) as { transcript?: string; error?: string };
  } catch {
    throw new Error("Couldn't hear that. Try again.");
  }
  if (!res.ok || !body.transcript?.trim()) {
    throw new Error(body.error || "Couldn't hear that. Try again.");
  }
  return body.transcript.trim();
}

export async function requestExperimentReact(
  input: {
    topic: string;
    title: string;
    ask: string;
    expect: string;
    answer: string;
    lastSay: string;
    mode?: "tutor" | "physics";
  },
  signal?: AbortSignal,
): Promise<ExperimentFollowup> {
  const res = await fetch("/api/experiment/react", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  let body: { followup?: ExperimentFollowup; error?: string } = {};
  try {
    body = (await res.json()) as {
      followup?: ExperimentFollowup;
      error?: string;
    };
  } catch {
    throw new Error("Could not explain that. Try another question.");
  }
  if (!res.ok || !body.followup?.say) {
    throw new Error(
      body.error || "Could not explain that. Try another question.",
    );
  }
  return body.followup;
}

export async function playExperimentAudio(
  spoken: { mimeType: string; base64: string },
  signal?: AbortSignal,
) {
  const bytes = Uint8Array.from(atob(spoken.base64), (char) =>
    char.charCodeAt(0),
  );
  const blob = new Blob([bytes], { type: spoken.mimeType });

  if (audioTap) {
    if (audioTap.context.state === "suspended") {
      await audioTap.context.resume().catch(() => undefined);
    }
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    let buffer: AudioBuffer | null = null;
    try {
      buffer = await audioTap.context.decodeAudioData(copy);
    } catch {
      buffer = null;
    }
    if (buffer) {
      const source = audioTap.context.createBufferSource();
      source.buffer = buffer;
      source.connect(audioTap.dest);
      source.connect(audioTap.context.destination);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          try {
            source.stop();
          } catch {
            /* already stopped */
          }
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        source.onended = () => resolve();
        source.start();
      });
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        audio.pause();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadSavedLessonVideo(input: {
  video: Blob;
  poster?: Blob;
  lesson: ExperimentLesson;
  durationMs?: number;
  accessToken?: string | null;
}): Promise<{ video: import("@/lib/experiment/savedVideos").SavedLessonVideo }> {
  const form = new FormData();
  form.set("video", input.video, "lesson.webm");
  if (input.poster) form.set("poster", input.poster, "poster.jpg");
  form.set("lesson", JSON.stringify(input.lesson));
  if (input.lesson.question) form.set("question", input.lesson.question);
  if (input.durationMs) form.set("durationMs", String(input.durationMs));

  const res = await fetch("/api/experiment/videos", {
    method: "POST",
    ...(input.accessToken
      ? { headers: { Authorization: `Bearer ${input.accessToken}` } }
      : {}),
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as {
    video?: import("@/lib/experiment/savedVideos").SavedLessonVideo;
    error?: string;
  };
  if (!res.ok || !body.video) {
    throw new Error(body.error || "Could not save that video.");
  }
  return { video: body.video };
}
