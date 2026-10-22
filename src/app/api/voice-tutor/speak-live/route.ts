import { envPresence, getDeepgramConfig } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { prepareTutorSpokenText } from "@/lib/providers/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Streaming TTS sample rate (Hz). Must match client AudioContext playback. */
export const VOICE_TUTOR_TTS_SAMPLE_RATE = 24_000;

/**
 * Streaming Speak proxy: prepare spoken text, open Deepgram Speak WebSocket,
 * stream raw linear16 PCM back as the HTTP body so the browser can play ASAP.
 */
export async function POST(request: Request) {
  const presence = envPresence();
  if (!presence.DEEPGRAM_API_KEY) {
    return Response.json({ error: "Voice is not configured." }, { status: 503 });
  }

  let json: { text?: unknown } = {};
  try {
    json = (await request.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: "Nothing to speak." }, { status: 400 });
  }

  const text = typeof json.text === "string" ? json.text.trim() : "";
  if (!text || text.length > 900) {
    return Response.json({ error: "Nothing to speak." }, { status: 400 });
  }

  let spoken: string;
  try {
    spoken = await prepareTutorSpokenText(text, { mode: "tutor" });
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "Couldn't speak that line. The explanation is still on screen.",
        ),
      },
      { status: 500 },
    );
  }

  const { apiKey, model } = getDeepgramConfig();
  const dgUrl = new URL("wss://api.deepgram.com/v1/speak");
  dgUrl.searchParams.set("model", model);
  dgUrl.searchParams.set("encoding", "linear16");
  dgUrl.searchParams.set("sample_rate", String(VOICE_TUTOR_TTS_SAMPLE_RATE));

  let dg: WebSocket | null = null;
  let settled = false;
  let gotAudio = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        try {
          controller.error(new Error(message));
        } catch {
          /* ignore */
        }
        cleanupDg();
      };

      const endOk = () => {
        if (settled) return;
        settled = true;
        try {
          controller.close();
        } catch {
          /* ignore */
        }
        cleanupDg();
      };

      const cleanupDg = () => {
        if (!dg) return;
        const socket = dg;
        dg = null;
        try {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "Close" }));
          }
          socket.close();
        } catch {
          /* ignore */
        }
      };

      try {
        dg = new WebSocket(dgUrl.toString(), ["token", apiKey]);
      } catch (error) {
        fail(
          toUserFacingError(
            error,
            "Couldn't speak that line. The explanation is still on screen.",
          ),
        );
        return;
      }

      // Binary frames from Deepgram are ArrayBuffer / Buffer in Node.
      dg.binaryType = "arraybuffer";

      dg.addEventListener("open", () => {
        try {
          dg!.send(JSON.stringify({ type: "Speak", text: spoken }));
          dg!.send(JSON.stringify({ type: "Flush" }));
        } catch (error) {
          fail(
            toUserFacingError(
              error,
              "Couldn't speak that line. The explanation is still on screen.",
            ),
          );
        }
      });

      dg.addEventListener("message", (event) => {
        if (settled) return;

        if (typeof event.data === "string") {
          let msg: { type?: string } = {};
          try {
            msg = JSON.parse(event.data) as { type?: string };
          } catch {
            return;
          }
          if (msg.type === "Flushed") {
            // Audio for this Flush is complete — close the Speak stream.
            try {
              if (dg && dg.readyState === WebSocket.OPEN) {
                dg.send(JSON.stringify({ type: "Close" }));
              }
            } catch {
              /* ignore */
            }
            if (gotAudio) {
              endOk();
            }
            return;
          }
          if (msg.type === "Warning" || msg.type === "Metadata") return;
          return;
        }

        const raw = event.data;
        let bytes: Uint8Array | null = null;
        if (raw instanceof ArrayBuffer) {
          bytes = new Uint8Array(raw);
        } else if (ArrayBuffer.isView(raw)) {
          bytes = new Uint8Array(
            raw.buffer,
            raw.byteOffset,
            raw.byteLength,
          );
        } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
          bytes = new Uint8Array(raw);
        }
        if (!bytes || bytes.byteLength === 0) return;
        gotAudio = true;
        try {
          controller.enqueue(bytes);
        } catch {
          cleanupDg();
        }
      });

      dg.addEventListener("error", () => {
        if (!gotAudio) {
          fail("Couldn't speak that line. The explanation is still on screen.");
        } else {
          endOk();
        }
      });

      dg.addEventListener("close", () => {
        if (!settled) {
          if (gotAudio) endOk();
          else fail("Couldn't speak that line. The explanation is still on screen.");
        }
      });

      request.signal.addEventListener(
        "abort",
        () => {
          cleanupDg();
          if (!settled) {
            settled = true;
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
      settled = true;
      try {
        if (dg && dg.readyState === WebSocket.OPEN) {
          dg.send(JSON.stringify({ type: "Close" }));
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
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Audio-Encoding": "linear16",
      "X-Audio-Sample-Rate": String(VOICE_TUTOR_TTS_SAMPLE_RATE),
      "X-Audio-Channels": "1",
    },
  });
}
