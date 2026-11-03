"use client";

/**
 * Everything the lesson stage showed for one History session — text board,
 * diagrams, sourced pictures, whiteboard, the student's picture / 3D model and
 * the finished video. Lives in IndexedDB (blobs + size) keyed by session id;
 * the chat transcript stays in historyStore's localStorage list.
 */

import type { LessonSection, LessonStanza } from "@/components/voice-tutor/LessonStage";
import type { TeachFormats } from "@/components/voice-tutor/TeachFormatPicker";
import type { TeachingImage } from "@/lib/voice-tutor/images/types";
import type {
  BoardContent,
  DrawScene,
  VoiceLessonPlan,
} from "@/lib/voice-tutor/sessionTypes";
import type { WhiteboardSession } from "@/lib/voice-tutor/whiteboard/schema";

export type SavedMedia =
  | { kind: "image"; image: Blob; subject?: string }
  | {
      kind: "model3d";
      image: Blob;
      subject?: string;
      modelUrl?: string;
      scene?: { title: string; brief: string; code: string; attempt: number };
    };

export type SavedVideo = { topic: string; blob: Blob; title: string; fileName: string };

export type SessionVisuals = {
  id: string;
  savedAt: number;
  formats?: TeachFormats;
  plan: VoiceLessonPlan | null;
  board: BoardContent | null;
  draw: DrawScene | null;
  drawings: Array<{ title: string; scene: DrawScene }>;
  sections: LessonSection[];
  stanzas: LessonStanza[];
  figures: Record<string, TeachingImage>;
  whiteboard: WhiteboardSession | null;
  media: SavedMedia | null;
  video: SavedVideo | null;
};

const DB_NAME = "seethrough.voiceTutor";
const STORE = "visuals";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveSessionVisuals(visuals: SessionVisuals): Promise<void> {
  try {
    await run("readwrite", (store) => store.put(visuals));
  } catch (err) {
    console.warn("[voice-tutor/history] couldn't save lesson visuals", err);
  }
}

export async function loadSessionVisuals(id: string): Promise<SessionVisuals | null> {
  try {
    const found = await run<SessionVisuals | undefined>("readonly", (store) => store.get(id));
    return found ?? null;
  } catch {
    return null;
  }
}

export async function deleteSessionVisuals(id: string): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(id));
  } catch {
    /* nothing stored */
  }
}

/** Drop visuals whose History entry no longer exists (trimmed / deleted). */
export async function pruneSessionVisuals(keepIds: string[]): Promise<void> {
  try {
    const keys = await run("readonly", (store) => store.getAllKeys());
    const keep = new Set(keepIds);
    await Promise.all(
      keys
        .map(String)
        .filter((key) => !keep.has(key))
        .map((key) => deleteSessionVisuals(key)),
    );
  } catch {
    /* best effort */
  }
}

/** Read a blob: / same-origin URL back into a Blob (null if it's gone). */
export async function blobFromUrl(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}
