"use client";

/**
 * Background video explainer for a voice lesson — the same plan → scene code →
 * direct → shoot pipeline as /video, minus the outline-review step.
 *
 * The job owns its canvas so it survives re-renders; LessonVideoPanel mounts
 * that canvas for a live preview while filming.
 */

import { directFilm, type DirectorStatus } from "@/components/explain-video/direct";
import { FRAME_HEIGHT, FRAME_WIDTH } from "@/components/explain-video/paint";
import { shootFilm } from "@/components/explain-video/shoot";
import {
  mixNarration,
  recordNarration,
  type Narration,
} from "@/components/explain-video/voice";
import {
  planSchema,
  retimeToVoice,
  sceneCodeResponseSchema,
  TOPIC_MAX,
} from "@/lib/explain-video/film";

export type LessonVideoStatus =
  | { kind: "planning" }
  | { kind: "writing"; scenes: number }
  | { kind: "checking"; detail: string }
  | { kind: "filming"; progress: number }
  | { kind: "ready"; url: string; title: string; fileName: string }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

const FAILED = "The video couldn't be made this time.";

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : FAILED;
    throw new Error(message);
  }
  return payload;
}

function fileSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "lesson-video"
  );
}

function directorDetail(status: DirectorStatus): string {
  return status.kind === "checking"
    ? `Checking scene ${status.index + 1} of ${status.total}`
    : `Fixing ${status.count} scene${status.count === 1 ? "" : "s"}`;
}

export class LessonVideoJob {
  readonly topic: string;
  readonly canvas: HTMLCanvasElement;
  private current: LessonVideoStatus = { kind: "planning" };
  private listeners = new Set<() => void>();
  private cancelled = false;
  private url: string | null = null;

  constructor(topic: string) {
    this.topic = topic.trim().slice(0, TOPIC_MAX);
    this.canvas = document.createElement("canvas");
    this.canvas.width = FRAME_WIDTH;
    this.canvas.height = FRAME_HEIGHT;
    this.canvas.className = "block h-full w-full";
    void this.run();
  }

  get status(): LessonVideoStatus {
    return this.current;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LessonVideoStatus => this.current;

  /** Stop work and free the video. Safe to call twice. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.set({ kind: "cancelled" });
  }

  private set(next: LessonVideoStatus) {
    if (this.cancelled && next.kind !== "cancelled") return;
    this.current = next;
    for (const listener of this.listeners) listener();
  }

  private async run(): Promise<void> {
    const alive = () => !this.cancelled;
    try {
      const planned = planSchema.safeParse(
        await postJson("/api/explain-video", { topic: this.topic }),
      );
      if (!alive()) return;
      if (!planned.success) throw new Error(FAILED);
      const film = planned.data;
      this.set({ kind: "writing", scenes: film.scenes.length });

      const recording = recordNarration(film.scenes.map((scene) => scene.speak)).catch(
        (): Narration => ({ ok: false, reason: "failed" }),
      );
      const drawn = sceneCodeResponseSchema.safeParse(
        await postJson("/api/explain-video/scenes", { topic: this.topic, plan: film }),
      );
      if (!alive()) return;
      if (!drawn.success || drawn.data.scenes.length !== film.scenes.length) {
        throw new Error(FAILED);
      }
      const narration = await recording;
      if (!alive()) return;

      const timed = narration.ok
        ? retimeToVoice(film, narration.clips.map((clip) => clip?.duration ?? null))
        : film;
      this.set({ kind: "checking", detail: "Checking scenes" });
      const directed = await directFilm({
        topic: this.topic,
        plan: timed,
        codes: drawn.data.scenes.map((scene) => scene.code),
        serverErrors: drawn.data.scenes.map((scene) => scene.error),
        onStatus: (status) => this.set({ kind: "checking", detail: directorDetail(status) }),
        isCancelled: () => !alive(),
      });
      if (!directed) return;
      if (!alive() || directed.fallbacks.length === timed.scenes.length) {
        directed.engine.dispose();
        if (alive()) throw new Error(FAILED);
        return;
      }

      const audio = narration.ok ? await mixNarration(timed, narration.clips).catch(() => null) : null;
      if (!alive()) {
        directed.engine.dispose();
        return;
      }
      this.set({ kind: "filming", progress: 0 });
      let lastPercent = -1;
      const shot = await shootFilm({
        engine: directed.engine,
        canvas: this.canvas,
        fps: directed.fps,
        audio,
        isCancelled: () => !alive(),
        onFrame: ({ frame, frames }) => {
          const percent = Math.floor((frame / Math.max(1, frames - 1)) * 100);
          if (percent === lastPercent) return;
          lastPercent = percent;
          this.set({ kind: "filming", progress: percent / 100 });
        },
      });
      directed.engine.dispose();
      if (!alive()) return;
      if (!shot) throw new Error("This browser couldn't save the video file.");

      this.url = URL.createObjectURL(shot.blob);
      const ext = shot.blob.type.includes("mp4") ? "mp4" : "webm";
      this.set({
        kind: "ready",
        url: this.url,
        title: timed.title,
        fileName: `${fileSlug(timed.title)}.${ext}`,
      });
    } catch (error) {
      if (!alive()) return;
      console.warn("[voice-tutor/video]", error);
      this.set({
        kind: "error",
        message: error instanceof Error && error.message ? error.message : FAILED,
      });
    }
  }
}
