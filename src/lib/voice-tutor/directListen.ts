/**
 * Browser → Deepgram live STT, no server hop for audio.
 *
 * /api/voice-tutor/stt-token mints a short-lived token; the browser opens the
 * Listen WebSocket itself (auth via the ["bearer", token] subprotocol, the
 * same way Deepgram's JS SDK does it). Mic chunks recorded before the socket
 * opens are queued, so the first words of a turn aren't lost.
 */

import { applyDeepgramListenParams } from "@/lib/voice-tutor/sttParams";
import { MIN_STT_CONFIDENCE } from "@/lib/voice-tutor/sttConfidence";

type Grant = { token: string; model: string; expiresAt: number };

/** Refresh a token this long before Deepgram would reject it. */
const TOKEN_MARGIN_MS = 10_000;

let cachedGrant: Grant | null = null;
let grantInFlight: Promise<Grant> | null = null;
/**
 * The server can't mint tokens (no key, or the key lacks Deepgram's Member
 * role). Stop trying for this page load so turns go straight to the fallback.
 */
let tokensUnavailable = false;

export function isDirectListenAvailable(): boolean {
  return !tokensUnavailable;
}

async function fetchGrant(): Promise<Grant> {
  const res = await fetch("/api/voice-tutor/stt-token", {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 502 || res.status === 503 || res.status === 403) tokensUnavailable = true;
    throw new Error(`stt_token_http_${res.status}`);
  }
  const body = (await res.json()) as { token?: string; expiresIn?: number; model?: string };
  if (!body.token) throw new Error("stt_token_missing");
  return {
    token: body.token,
    model: body.model || "nova-3",
    expiresAt: Date.now() + (body.expiresIn ?? 30) * 1000,
  };
}

/** A token that is still good for opening a socket, fetching one if needed. */
async function getGrant(): Promise<Grant> {
  if (cachedGrant && cachedGrant.expiresAt - TOKEN_MARGIN_MS > Date.now()) {
    return cachedGrant;
  }
  grantInFlight ??= fetchGrant()
    .then((grant) => {
      cachedGrant = grant;
      return grant;
    })
    .finally(() => {
      grantInFlight = null;
    });
  return grantInFlight;
}

/** Fetch a token ahead of time so the first turn doesn't wait on it. */
export function prewarmDirectListen(): void {
  void getGrant().catch(() => undefined);
}

export type DirectListenOptions = {
  mediaStream: MediaStream;
  utteranceEndMs: number;
  endpointingMs: number;
  maxMs: number;
  keyterms?: readonly string[];
  signal?: AbortSignal;
  onPartial?: (transcript: string) => void;
};

type DgResult = {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
};

function pickMimeType(): string {
  if (
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
  ) {
    return "audio/webm;codecs=opus";
  }
  return "audio/webm";
}

/**
 * Listen for one utterance over a direct Deepgram socket. Resolves with the
 * transcript (null for silence / noise / abort). Rejects only when the
 * socket can't be used at all, so the caller can fall back.
 */
export async function directListenUntilUtterance(
  options: DirectListenOptions,
): Promise<string | null> {
  if (options.signal?.aborted) return null;

  // Start recording right away; chunks queue until the socket is open.
  const recorder = new MediaRecorder(options.mediaStream, { mimeType: pickMimeType() });
  const queue: Blob[] = [];
  let ws: WebSocket | null = null;
  recorder.ondataavailable = (event) => {
    if (event.data.size <= 0) return;
    if (ws?.readyState === WebSocket.OPEN) ws.send(event.data);
    else queue.push(event.data);
  };
  recorder.start(100);

  const stopRecorder = () => {
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* already stopped */
    }
  };

  let grant: Grant;
  try {
    grant = await getGrant();
  } catch (error) {
    stopRecorder();
    throw error;
  }
  if (options.signal?.aborted) {
    stopRecorder();
    return null;
  }

  const url = new URL("wss://api.deepgram.com/v1/listen");
  applyDeepgramListenParams(url, grant.model, options.keyterms ?? []);
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("utterance_end_ms", String(Math.max(1000, options.utteranceEndMs)));
  url.searchParams.set("endpointing", String(options.endpointingMs));

  return new Promise<string | null>((resolve, reject) => {
    let settled = false;
    let opened = false;
    let finalized = "";
    let latest = "";

    const socket = new WebSocket(url.toString(), ["bearer", grant.token]);
    ws = socket;

    const closeSocket = () => {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "CloseStream" }));
        }
        socket.close();
      } catch {
        /* ignore */
      }
    };

    const cleanup = () => {
      window.clearTimeout(capTimer);
      options.signal?.removeEventListener("abort", onAbort);
      stopRecorder();
      closeSocket();
    };

    const finish = (text: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      const trimmed = text?.trim() ?? "";
      resolve(trimmed ? trimmed : null);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      // A token can be rejected mid-life (revoked / clock skew) — refetch next time.
      cachedGrant = null;
      reject(error);
    };

    const onAbort = () => finish(null);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    // Hard cap: stop sending, let Deepgram flush, then take what we have.
    const capTimer = window.setTimeout(() => {
      stopRecorder();
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "CloseStream" }));
        }
      } catch {
        /* ignore */
      }
      window.setTimeout(() => finish(finalized || latest), 1500);
    }, options.maxMs);

    socket.addEventListener("open", () => {
      opened = true;
      for (const chunk of queue.splice(0)) socket.send(chunk);
    });

    socket.addEventListener("message", (event) => {
      let msg: DgResult;
      try {
        msg = JSON.parse(String(event.data)) as DgResult;
      } catch {
        return;
      }
      if (msg.type === "UtteranceEnd") {
        finish(finalized || latest);
        return;
      }
      if (msg.type && msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      const piece = alt?.transcript?.trim() ?? "";
      if (!piece) return;
      // Background talk / TV comes back low-confidence — not the student.
      if (typeof alt?.confidence === "number" && alt.confidence < MIN_STT_CONFIDENCE) return;
      if (msg.is_final) {
        finalized = finalized ? `${finalized} ${piece}` : piece;
        latest = finalized;
      } else {
        latest = finalized ? `${finalized} ${piece}` : piece;
      }
      options.onPartial?.(latest);
    });

    socket.addEventListener("error", () => {
      if (!opened) fail(new Error("direct_listen_socket_failed"));
    });

    socket.addEventListener("close", () => {
      if (!opened) fail(new Error("direct_listen_socket_closed"));
      else finish(finalized || latest);
    });
  });
}
