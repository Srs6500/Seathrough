import type { HistorySession } from "@/lib/voice-tutor/sessionTypes";

const KEY = "seethrough.voiceTutor.history.v1";
const MAX = 40;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function listHistorySessions(): HistorySession[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistorySession[];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveHistorySession(session: HistorySession): void {
  if (!canUseStorage()) return;
  const all = listHistorySessions().filter((item) => item.id !== session.id);
  all.unshift(session);
  window.localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
}

export function getHistorySession(id: string): HistorySession | null {
  return listHistorySessions().find((item) => item.id === id) ?? null;
}

export function deleteHistorySession(id: string): void {
  if (!canUseStorage()) return;
  const next = listHistorySessions().filter((item) => item.id !== id);
  window.localStorage.setItem(KEY, JSON.stringify(next));
}
