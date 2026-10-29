import { coerceLesson, type ExperimentLesson } from "@/lib/experiment/scene";
import {
  MAX_SAVED_MESSAGES,
  type DesignMessage,
} from "@/lib/experiment/systemDesign/session";

export type DiagramHistoryStore = "diagram" | "physics";

function storageKey(store: DiagramHistoryStore): string {
  return store === "physics"
    ? "seethrough.smartTutor.physics.history.v1"
    : "seethrough.smartTutor.diagram.history.v1";
}

const MAX = 20;
const MAX_MESSAGE_TEXT = 1200;

export type DiagramHistorySession = {
  id: string;
  label: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  ended: boolean;
  lesson: ExperimentLesson | null;
  messages: DesignMessage[];
  currentBeat: number;
};

export function newDiagramHistoryId(): string {
  return `dg_${crypto.randomUUID()}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readMessages(raw: unknown): DesignMessage[] {
  if (!Array.isArray(raw)) return [];
  const messages: DesignMessage[] = [];
  for (const item of raw.slice(-MAX_SAVED_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const role = obj.role === "user" || obj.role === "tutor" ? obj.role : null;
    const text =
      typeof obj.text === "string" ? obj.text.trim().slice(0, MAX_MESSAGE_TEXT) : "";
    if (!role || !text) continue;
    const afterBeat =
      typeof obj.afterBeat === "number" && Number.isInteger(obj.afterBeat)
        ? Math.max(-1, Math.min(obj.afterBeat, 500))
        : -1;
    messages.push({
      id:
        typeof obj.id === "string" && obj.id
          ? obj.id.slice(0, 64)
          : `m${messages.length}`,
      role,
      text,
      afterBeat,
      ...(obj.failed === true ? { failed: true } : {}),
    });
  }
  return messages;
}

function compactLesson(lesson: ExperimentLesson): ExperimentLesson {
  return {
    title: lesson.title,
    ...(lesson.question ? { question: lesson.question } : {}),
    beats: lesson.beats,
  };
}

function parseSession(raw: unknown): DiagramHistorySession | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim().slice(0, 80) : "";
  if (!id) return null;
  const createdAt =
    typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now();
  const updatedAt =
    typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : createdAt;
  const topic = typeof obj.topic === "string" ? obj.topic.trim().slice(0, 200) : "";
  const label = typeof obj.label === "string" ? obj.label.trim().slice(0, 80) : "";
  let lesson: ExperimentLesson | null = null;
  if (obj.lesson && typeof obj.lesson === "object") {
    const coerced = coerceLesson(obj.lesson);
    if (coerced.beats.length) lesson = compactLesson(coerced);
  }
  const messages = readMessages(obj.messages);
  if (!lesson && !messages.length && !topic) return null;
  const beatCount = lesson?.beats.length ?? 0;
  const currentBeat =
    typeof obj.currentBeat === "number" && Number.isInteger(obj.currentBeat)
      ? Math.max(-1, Math.min(obj.currentBeat, Math.max(0, beatCount - 1)))
      : beatCount
        ? beatCount - 1
        : -1;
  return {
    id,
    label: label || topic || lesson?.title || "Lesson",
    topic: topic || lesson?.question || label || "Lesson",
    createdAt,
    updatedAt,
    ended: obj.ended === true,
    lesson,
    messages,
    currentBeat,
  };
}

function readAll(store: DiagramHistoryStore): DiagramHistorySession[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(store));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseSession)
      .filter((item): item is DiagramHistorySession => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeAll(
  store: DiagramHistoryStore,
  sessions: DiagramHistorySession[],
): void {
  if (!canUseStorage()) return;
  const trimmed = sessions.slice(0, MAX);
  for (let count = trimmed.length; count >= 0; count -= 1) {
    try {
      window.localStorage.setItem(
        storageKey(store),
        JSON.stringify(count > 0 ? trimmed.slice(0, count) : []),
      );
      return;
    } catch {
      /* drop older lessons until the quota fits */
    }
  }
}

export function listDiagramHistorySessions(
  store: DiagramHistoryStore = "diagram",
): DiagramHistorySession[] {
  return readAll(store);
}

export function saveDiagramHistorySession(
  session: DiagramHistorySession,
  store: DiagramHistoryStore = "diagram",
): void {
  if (!canUseStorage()) return;
  const next = parseSession({
    ...session,
    lesson: session.lesson ? compactLesson(session.lesson) : null,
    updatedAt: Date.now(),
  });
  if (!next) return;
  const all = readAll(store).filter((item) => item.id !== next.id);
  all.unshift(next);
  writeAll(store, all);
}

export function getDiagramHistorySession(
  id: string,
  store: DiagramHistoryStore = "diagram",
): DiagramHistorySession | null {
  return readAll(store).find((item) => item.id === id) ?? null;
}

export function deleteDiagramHistorySession(
  id: string,
  store: DiagramHistoryStore = "diagram",
): void {
  if (!canUseStorage()) return;
  writeAll(
    store,
    readAll(store).filter((item) => item.id !== id),
  );
}
