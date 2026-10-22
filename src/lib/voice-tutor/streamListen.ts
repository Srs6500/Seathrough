/**
 * Streaming listen for Voice Tutor.
 * Prefers live Deepgram via /api/voice-tutor/listen-live (UtteranceEnd).
 * Falls back to local energy-VAD + batch /listen when duplex streaming fails.
 */

import { requestVoiceTutorListen } from "@/lib/voice-tutor/client";
import { listenUntilSilence, MIC_CONSTRAINTS } from "@/lib/voice-tutor/listenLoop";

export type StreamListenOptions = {
  /** Deepgram word-gap before UtteranceEnd (ms). Min useful ~1000. */
  utteranceEndMs?: number;
  /** Deepgram audio-silence endpointing (ms). Does not alone end our turn. */
  endpointingMs?: number;
  /** Hard cap for one listen attempt (ms). */
  maxMs?: number;
  signal?: AbortSignal;
  /** Interim transcript for UI (raw Deepgram text). */
  onPartial?: (transcript: string) => void;
  /**
   * Reuse a session MediaStream (duplex). When set, tracks are NOT stopped
   * after the utterance — the session owns mic lifetime.
   */
  mediaStream?: MediaStream;
};

type LiveEvent =
  | { type: "partial"; transcript?: string }
  | { type: "final"; transcript?: string }
  | { type: "error"; error?: string };

function pickMimeType(): string {
  if (
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
  ) {
    return "audio/webm;codecs=opus";
  }
  return "audio/webm";
}

function supportsStreamingUpload(): boolean {
  if (typeof fetch !== "function" || typeof ReadableStream === "undefined") {
    return false;
  }
  // Chrome/Edge: RequestInit.duplex = "half" is required for streaming bodies.
  // Safari/Firefox historically lack this — batch fallback covers them.
  try {
    const probe = new Request("data:text/plain,", {
      method: "POST",
      body: new ReadableStream(),
      // @ts-expect-error duplex is Chromium RequestInit
      duplex: "half",
    });
    return Boolean(probe);
  } catch {
    return false;
  }
}

async function streamListenLive(
  options: StreamListenOptions = {},
): Promise<string | null> {
  if (options.signal?.aborted) return null;
  if (!supportsStreamingUpload()) {
    throw new Error("streaming_upload_unsupported");
  }

  const utteranceEndMs = options.utteranceEndMs ?? 2500;
  const endpointingMs = options.endpointingMs ?? 750;
  const maxMs = options.maxMs ?? 20000;
  const mime = pickMimeType();
  const shared = Boolean(options.mediaStream);

  const media =
    options.mediaStream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: MIC_CONSTRAINTS,
    }));
  const recorder = new MediaRecorder(media, { mimeType: mime });
  let stopped = false;
  let writeChain = Promise.resolve();

  const stopAll = () => {
    if (stopped) return;
    stopped = true;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* ignore */
    }
    if (!shared) {
      media.getTracks().forEach((t) => t.stop());
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      recorder.ondataavailable = (event) => {
        if (stopped || event.data.size <= 0) return;
        writeChain = writeChain
          .then(async () => {
            if (stopped) return;
            const buf = new Uint8Array(await event.data.arrayBuffer());
            if (!stopped && buf.byteLength > 0) {
              controller.enqueue(buf);
            }
          })
          .catch(() => undefined);
      };
      recorder.onstop = () => {
        void writeChain.finally(() => {
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });
      };
      recorder.onerror = () => {
        try {
          controller.error(new Error("mic_recorder_failed"));
        } catch {
          /* ignore */
        }
      };
      recorder.start(250);
    },
    cancel() {
      stopAll();
    },
  });

  const url = `/api/voice-tutor/listen-live?utterance_end_ms=${utteranceEndMs}&endpointing=${endpointingMs}`;
  const timeoutId = window.setTimeout(() => stopAll(), maxMs);

  const onAbort = () => stopAll();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": mime,
        Accept: "application/x-ndjson",
      },
      body,
      signal: options.signal,
      // @ts-expect-error duplex is required for streaming request bodies in Chromium
      duplex: "half",
    });

    if (!res.ok || !res.body) {
      throw new Error(`live_listen_http_${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalText: string | null = null;

    while (!options.signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: LiveEvent;
        try {
          msg = JSON.parse(trimmed) as LiveEvent;
        } catch {
          continue;
        }
        if (msg.type === "partial" && msg.transcript) {
          options.onPartial?.(msg.transcript);
        } else if (msg.type === "final") {
          finalText = (msg.transcript ?? "").trim();
          stopAll();
        } else if (msg.type === "error") {
          throw new Error(msg.error || "live_listen_error");
        }
      }
      if (finalText !== null) break;
    }

    stopAll();
    if (options.signal?.aborted) return null;
    return finalText && finalText.length > 0 ? finalText : null;
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onAbort);
    stopAll();
  }
}

async function streamListenBatchFallback(
  options: StreamListenOptions = {},
): Promise<string | null> {
  const afterShort = (options.utteranceEndMs ?? 2500) <= 1500;
  const blob = await listenUntilSilence({
    signal: options.signal,
    speechThreshold: afterShort ? 0.04 : 0.05,
    silenceMs: options.utteranceEndMs ?? 3500,
    minSpeechMs: afterShort ? 280 : 550,
    maxMs: options.maxMs ?? 20000,
    mediaStream: options.mediaStream,
  });
  if (!blob || options.signal?.aborted) return null;
  try {
    const transcript = await requestVoiceTutorListen(blob, options.signal);
    const text = transcript.trim();
    if (text) options.onPartial?.(text);
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Listen for one student utterance. Returns transcript or null (noise / abort).
 */
export async function streamListenUntilUtterance(
  options: StreamListenOptions = {},
): Promise<string | null> {
  if (options.signal?.aborted) return null;
  try {
    return await streamListenLive(options);
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error as Error)?.name === "AbortError"
    ) {
      return null;
    }
    return streamListenBatchFallback(options);
  }
}
