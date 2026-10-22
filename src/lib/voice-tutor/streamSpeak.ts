/**
 * Streaming tutor TTS: fetch linear16 PCM from /api/voice-tutor/speak-live
 * and play via AudioContext as chunks arrive. Falls back to batch MP3.
 */

import {
  playVoiceTutorAudio,
  requestVoiceTutorSpeak,
} from "@/lib/voice-tutor/client";

const DEFAULT_SAMPLE_RATE = 24_000;

class PcmStreamPlayer {
  private ctx: AudioContext;
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private leftover: Uint8Array | null = null;
  private stopped = false;
  private endedPromise: Promise<void>;
  private resolveEnded!: () => void;
  private activeSources = 0;

  constructor(sampleRate: number) {
    this.ctx = new AudioContext({ sampleRate });
    this.endedPromise = new Promise<void>((resolve) => {
      this.resolveEnded = resolve;
    });
  }

  async ensureRunning() {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume().catch(() => undefined);
    }
  }

  enqueue(chunk: Uint8Array) {
    if (this.stopped || chunk.byteLength === 0) return;

    let data = chunk;
    if (this.leftover) {
      const merged = new Uint8Array(this.leftover.byteLength + chunk.byteLength);
      merged.set(this.leftover, 0);
      merged.set(chunk, this.leftover.byteLength);
      data = merged;
      this.leftover = null;
    }
    // linear16 needs even byte length
    if (data.byteLength % 2 === 1) {
      this.leftover = data.subarray(data.byteLength - 1);
      data = data.subarray(0, data.byteLength - 1);
    }
    if (data.byteLength === 0) return;

    const int16 = new Int16Array(
      data.buffer,
      data.byteOffset,
      data.byteLength / 2,
    );
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i += 1) {
      f32[i] = int16[i]! / 32768;
    }

    const buffer = this.ctx.createBuffer(1, f32.length, this.ctx.sampleRate);
    buffer.copyToChannel(f32, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    // Small lead-in so the first buffer doesn't underrun.
    const startAt = Math.max(this.nextTime, now + 0.03);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.push(source);
    this.activeSources += 1;
    source.onended = () => {
      this.activeSources -= 1;
      if (this.stopped && this.activeSources <= 0) {
        this.resolveEnded();
      }
    };
  }

  /** Call when the network stream has finished delivering audio bytes. */
  markStreamComplete() {
    if (this.stopped) return;
    if (this.activeSources <= 0 && this.nextTime <= this.ctx.currentTime + 0.01) {
      this.resolveEnded();
      return;
    }
    const waitMs = Math.max(
      0,
      (this.nextTime - this.ctx.currentTime) * 1000 + 40,
    );
    window.setTimeout(() => {
      if (!this.stopped) this.resolveEnded();
    }, waitMs);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* ignore */
      }
    }
    this.sources = [];
    this.activeSources = 0;
    void this.ctx.close().catch(() => undefined);
    this.resolveEnded();
  }

  waitUntilDone(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      this.stop();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.stop();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void this.endedPromise.finally(() => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
        } else {
          resolve();
        }
      });
    });
  }
}

async function streamSpeakLive(
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const clipped = text.trim().slice(0, 900);
  if (!clipped) return;
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const res = await fetch("/api/voice-tutor/speak-live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clipped }),
    signal,
  });

  if (res.status === 503) {
    throw new Error("tts_unavailable");
  }
  if (!res.ok || !res.body) {
    throw new Error(`stream_speak_http_${res.status}`);
  }

  const sampleRate = Number(res.headers.get("X-Audio-Sample-Rate")) || DEFAULT_SAMPLE_RATE;
  const player = new PcmStreamPlayer(sampleRate);
  await player.ensureRunning();

  const onAbort = () => player.stop();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const reader = res.body.getReader();
    while (true) {
      if (signal?.aborted) {
        player.stop();
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) player.enqueue(value);
    }
    player.markStreamComplete();
    await player.waitUntilDone(signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    player.stop();
  }
}

async function speakBatchFallback(
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const spoken = await requestVoiceTutorSpeak(text, signal);
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  if (spoken) await playVoiceTutorAudio(spoken, signal);
}

/**
 * Speak one tutor line with streaming PCM when possible; batch MP3 otherwise.
 * Throws AbortError when interrupted.
 */
export async function streamSpeakTutorLine(
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const clipped = text.trim().slice(0, 900);
  if (!clipped) return;
  try {
    await streamSpeakLive(clipped, signal);
  } catch (error) {
    if ((error as Error)?.name === "AbortError" || signal?.aborted) {
      throw error instanceof DOMException
        ? error
        : new DOMException("Aborted", "AbortError");
    }
    await speakBatchFallback(clipped, signal);
  }
}
