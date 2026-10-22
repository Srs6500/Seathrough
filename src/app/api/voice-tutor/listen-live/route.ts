import { envPresence, getDeepgramConfig } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DgMessage = {
  type?: string;
  channel?: {
    alternatives?: Array<{ transcript?: string }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
};

/**
 * Streaming STT proxy: client uploads live mic audio; we forward to Deepgram
 * Listen WebSocket and stream NDJSON partials + a final transcript on UtteranceEnd.
 *
 * Uses the server DEEPGRAM_API_KEY (never exposed to the browser). Prefer
 * UtteranceEnd over speech_final so short thinking pauses do not cut the turn.
 */
export async function POST(request: Request) {
  const presence = envPresence();
  if (!presence.DEEPGRAM_API_KEY) {
    return Response.json({ error: "Voice is not configured." }, { status: 503 });
  }
  if (!request.body) {
    return Response.json(
      { error: "Couldn't hear that. Try again." },
      { status: 400 },
    );
  }

  const { apiKey, sttModel } = getDeepgramConfig();
  const reqUrl = new URL(request.url);
  const utteranceEndMs = clampInt(
    reqUrl.searchParams.get("utterance_end_ms"),
    1000,
    5000,
    2500,
  );
  const endpointing = clampInt(
    reqUrl.searchParams.get("endpointing"),
    10,
    3000,
    750,
  );

  const dgUrl = new URL("wss://api.deepgram.com/v1/listen");
  dgUrl.searchParams.set("model", sttModel);
  dgUrl.searchParams.set("smart_format", "true");
  dgUrl.searchParams.set("punctuate", "true");
  dgUrl.searchParams.set("interim_results", "true");
  dgUrl.searchParams.set("utterance_end_ms", String(utteranceEndMs));
  dgUrl.searchParams.set("endpointing", String(endpointing));

  const encoder = new TextEncoder();
  let dg: WebSocket | null = null;
  let settled = false;
  let closed = false;
  let finalized = "";
  let latest = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendEvent = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* stream already closed */
        }
      };

      const cleanupDg = () => {
        if (!dg) return;
        const socket = dg;
        dg = null;
        try {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "CloseStream" }));
          }
          socket.close();
        } catch {
          /* ignore */
        }
      };

      const finish = (transcript: string) => {
        if (settled) return;
        settled = true;
        sendEvent({ type: "final", transcript: transcript.trim() });
        closed = true;
        try {
          controller.close();
        } catch {
          /* ignore */
        }
        cleanupDg();
      };

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        sendEvent({ type: "error", error: message });
        closed = true;
        try {
          controller.close();
        } catch {
          /* ignore */
        }
        cleanupDg();
      };

      try {
        // Browser-safe auth pattern also works in Node — no custom headers needed.
        dg = new WebSocket(dgUrl.toString(), ["token", apiKey]);
      } catch (error) {
        fail(toUserFacingError(error, "Couldn't hear that. Try again."));
        return;
      }

      dg.addEventListener("open", () => {
        void (async () => {
          const reader = request.body!.getReader();
          try {
            while (!settled) {
              const { done, value } = await reader.read();
              if (done) break;
              if (
                value &&
                value.byteLength > 0 &&
                dg &&
                dg.readyState === WebSocket.OPEN
              ) {
                dg.send(value);
              }
            }
            if (!settled && dg && dg.readyState === WebSocket.OPEN) {
              dg.send(JSON.stringify({ type: "CloseStream" }));
            }
          } catch {
            if (!settled) {
              fail("Couldn't hear that. Try again.");
            }
          }
        })();
      });

      dg.addEventListener("message", (event) => {
        let msg: DgMessage;
        try {
          msg = JSON.parse(String(event.data)) as DgMessage;
        } catch {
          return;
        }

        if (msg.type === "UtteranceEnd") {
          finish(finalized || latest);
          return;
        }

        if (msg.type && msg.type !== "Results") return;

        const piece = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (!piece) return;

        if (msg.is_final) {
          finalized = finalized ? `${finalized} ${piece}` : piece;
          latest = finalized;
          sendEvent({ type: "partial", transcript: finalized, isFinal: true });
        } else {
          latest = finalized ? `${finalized} ${piece}` : piece;
          sendEvent({ type: "partial", transcript: latest, isFinal: false });
        }
      });

      dg.addEventListener("error", () => {
        fail("Couldn't hear that. Try again.");
      });

      dg.addEventListener("close", () => {
        if (!settled) {
          finish(finalized || latest);
        }
      });

      request.signal.addEventListener(
        "abort",
        () => {
          cleanupDg();
          if (!settled) {
            settled = true;
            closed = true;
            try {
              controller.close();
            } catch {
              /* ignore */
            }
          }
        },
        { once: true },
      );
    },
    cancel() {
      closed = true;
      settled = true;
      try {
        if (dg && dg.readyState === WebSocket.OPEN) {
          dg.send(JSON.stringify({ type: "CloseStream" }));
        }
        dg?.close();
      } catch {
        /* ignore */
      }
      dg = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function clampInt(
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
