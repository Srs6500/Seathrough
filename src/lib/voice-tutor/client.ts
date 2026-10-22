import type { ChatMessage, TurnResponse, VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";

export async function requestVoiceTurn(input: {
  mode: "greet" | "chat" | "plan";
  userText?: string;
  topic?: string;
  messages?: ChatMessage[];
  /** Active lesson topic — enables voice-only off-topic redirects. */
  activeTopic?: string;
  teaching?: boolean;
  /** Student is answering a subtopic prompt — never re-clarify. */
  awaitingFocus?: boolean;
  parentTopic?: string;
  focusOptions?: string[];
  /** After a countdown interrupt — always offer subtopics. */
  preferClarify?: boolean;
  /** Mid-lesson confusion barge-in. */
  clarifyAside?: boolean;
  /** Partial voice-only doubt nudge. */
  partialAside?: boolean;
  /** End-of-lesson deferred follow-up. */
  deferredClose?: boolean;
  /** Focus options already offered for this parent. */
  avoidedFocusOptions?: string[];
  lessonContext?: {
    beatSay?: string;
    highlight?: string;
    rememberTip?: string;
  };
  signal?: AbortSignal;
}): Promise<TurnResponse> {
  const res = await fetch("/api/voice-tutor/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: input.mode,
      userText: input.userText,
      topic: input.topic,
      messages: input.messages ?? [],
      activeTopic: input.activeTopic,
      teaching: input.teaching,
      awaitingFocus: input.awaitingFocus,
      parentTopic: input.parentTopic,
      focusOptions: input.focusOptions,
      preferClarify: input.preferClarify,
      clarifyAside: input.clarifyAside,
      partialAside: input.partialAside,
      deferredClose: input.deferredClose,
      avoidedFocusOptions: input.avoidedFocusOptions,
      lessonContext: input.lessonContext,
    }),
    signal: input.signal,
  });
  let body: TurnResponse & { error?: string } = {
    say: "",
    action: "speak",
  };
  try {
    body = (await res.json()) as TurnResponse & { error?: string };
  } catch {
    throw new Error("Couldn't continue the voice lesson.");
  }
  if (!res.ok) {
    throw new Error(body.error || "Couldn't continue the voice lesson.");
  }
  return body;
}

export async function requestVoiceTutorSpeak(
  text: string,
  signal?: AbortSignal,
): Promise<{ mimeType: string; base64: string } | null> {
  const clipped = text.trim().slice(0, 900);
  if (!clipped) return null;
  const res = await fetch("/api/voice-tutor/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clipped }),
    signal,
  });
  if (res.status === 503) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as { mimeType?: string; base64?: string };
  if (!body.base64) return null;
  return { mimeType: body.mimeType || "audio/mpeg", base64: body.base64 };
}

export async function requestVoiceTutorListen(
  audio: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/voice-tutor/listen", {
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

export async function playVoiceTutorAudio(
  spoken: { mimeType: string; base64: string },
  signal?: AbortSignal,
): Promise<void> {
  const bytes = Uint8Array.from(atob(spoken.base64), (char) =>
    char.charCodeAt(0),
  );
  const blob = new Blob([bytes], { type: spoken.mimeType });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playbackRate = 1;
  try {
    await new Promise<void>((resolve, reject) => {
      const hardStop = () => {
        try {
          audio.pause();
          audio.currentTime = 0;
          audio.removeAttribute("src");
          audio.load();
        } catch {
          /* ignore */
        }
      };
      const onAbort = () => {
        hardStop();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Audio playback failed."));
      void audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type { ChatMessage, TurnResponse, VoiceLessonPlan };
