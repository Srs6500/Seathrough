"use client";

import {
  getHistorySession,
  listHistorySessions,
  saveHistorySession,
} from "@/lib/voice-tutor/historyStore";
import {
  cloudVisualsFromLocal,
  toHistorySession,
  toLocalVisuals,
  type ParsedSmartTutorCloudSession,
  type SmartTutorCloudSession,
  type SmartTutorSessionSummary,
} from "@/lib/voice-tutor/smartTutorCloud";
import {
  loadSessionVisuals,
  saveSessionVisuals,
  type SessionVisuals,
} from "@/lib/voice-tutor/visualStore";

function auth(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

export async function listRemoteSmartTutorSessions(
  accessToken: string,
  signal?: AbortSignal,
): Promise<SmartTutorSessionSummary[]> {
  const res = await fetch("/api/smart-tutor/sessions", {
    headers: auth(accessToken),
    cache: "no-store",
    signal,
  });
  const body = await readJson<{ sessions?: SmartTutorSessionSummary[] }>(res);
  if (!res.ok) {
    if (res.status === 401 || res.status === 503) return [];
    throw new Error(body.error || "Could not load cloud history.");
  }
  return Array.isArray(body.sessions) ? body.sessions : [];
}

export async function fetchRemoteSmartTutorSession(
  accessToken: string,
  id: string,
  signal?: AbortSignal,
): Promise<ParsedSmartTutorCloudSession | null> {
  const res = await fetch(`/api/smart-tutor/sessions/${encodeURIComponent(id)}`, {
    headers: auth(accessToken),
    cache: "no-store",
    signal,
  });
  if (res.status === 404) return null;
  const body = await readJson<{ session?: ParsedSmartTutorCloudSession }>(res);
  if (!res.ok) {
    throw new Error(body.error || "Could not load cloud session.");
  }
  return body.session ?? null;
}

export async function upsertRemoteSmartTutorSession(
  accessToken: string,
  session: SmartTutorCloudSession,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/smart-tutor/sessions", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...auth(accessToken),
    },
    body: JSON.stringify({ session }),
    signal,
  });
  if (res.status === 401 || res.status === 503) return;
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(body.error || "Could not save to your account.");
  }
}

export async function deleteRemoteSmartTutorSession(
  accessToken: string,
  id: string,
): Promise<void> {
  const res = await fetch(`/api/smart-tutor/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: auth(accessToken),
  });
  if (res.status === 401 || res.status === 503 || res.status === 404) return;
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(body.error || "Could not delete cloud session.");
  }
}

/** Build cloud payload from local history + visuals (drops media blobs). */
export async function buildCloudSession(
  historyId: string,
): Promise<SmartTutorCloudSession | null> {
  const history = getHistorySession(historyId);
  if (!history) return null;
  const visuals = await loadSessionVisuals(historyId);
  return {
    ...history,
    visuals: cloudVisualsFromLocal(visuals),
  };
}

/** Push one local session to Supabase when signed in. Fail-soft. */
export async function pushSmartTutorSessionToCloud(
  accessToken: string | null | undefined,
  historyId: string,
): Promise<void> {
  if (!accessToken) return;
  try {
    const session = await buildCloudSession(historyId);
    if (!session) return;
    // Don't upload empty shells — wait until there's something to reopen.
    if (!session.messages.length && !session.visuals?.whiteboard && !session.visuals?.plan) {
      return;
    }
    await upsertRemoteSmartTutorSession(accessToken, session);
  } catch (error) {
    console.warn(
      "[smart-tutor/cloud] save failed",
      error instanceof Error ? error.message : "save failed",
    );
  }
}

/**
 * Pull account history into localStorage + IndexedDB so the History rail
 * and reopen path keep working offline on this device.
 */
export async function pullSmartTutorSessionsFromCloud(
  accessToken: string | null | undefined,
  signal?: AbortSignal,
): Promise<number> {
  if (!accessToken) return 0;
  try {
    const summaries = await listRemoteSmartTutorSessions(accessToken, signal);
    let imported = 0;
    for (const summary of summaries) {
      if (signal?.aborted) break;
      const local = getHistorySession(summary.id);
      const localVisuals = await loadSessionVisuals(summary.id);
      const needsFull =
        !local ||
        local.updatedAt < summary.updatedAt ||
        (!local.messages.length && summary.updatedAt > 0) ||
        (!localVisuals && summary.updatedAt > 0);

      if (!needsFull) continue;

      const remote = await fetchRemoteSmartTutorSession(
        accessToken,
        summary.id,
        signal,
      );
      if (!remote) {
        // At least show the rail entry from the summary.
        if (!local) {
          saveHistorySession({
            id: summary.id,
            label: summary.title,
            topic: summary.topic,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: [],
            ended: summary.ended,
          });
          imported += 1;
        }
        continue;
      }

      saveHistorySession(toHistorySession(remote));
      const visuals = toLocalVisuals(remote.id, remote.visuals);
      if (visuals) await saveSessionVisuals(visuals as SessionVisuals);
      imported += 1;
    }
    return imported;
  } catch (error) {
    console.warn(
      "[smart-tutor/cloud] pull failed",
      error instanceof Error ? error.message : "pull failed",
    );
    return 0;
  }
}

/** After pull, local list is the source of truth for the rail. */
export function localHistoryAfterCloudPull() {
  return listHistorySessions();
}
