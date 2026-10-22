/**
 * Smoke: Deepgram Speak WebSocket (Speak → Flush → Close) returns linear16 audio.
 *
 *   npm run smoke:voice-tutor-speak-live
 */
import assert from "node:assert/strict";

async function main() {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  assert.ok(apiKey, "DEEPGRAM_API_KEY missing — set in .env.local");

  const model = process.env.DEEPGRAM_TTS_MODEL?.trim() || "aura-2-thalia-en";
  const url = new URL("wss://api.deepgram.com/v1/speak");
  url.searchParams.set("model", model);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", "24000");

  let bytes = 0;
  let flushed = false;

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url.toString(), ["token", apiKey]);
    socket.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error("Deepgram speak WS timed out"));
    }, 15_000);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "Speak",
          text: "Streaming voice tutor check.",
        }),
      );
      socket.send(JSON.stringify({ type: "Flush" }));
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as { type?: string };
          if (msg.type === "Flushed") {
            flushed = true;
            socket.send(JSON.stringify({ type: "Close" }));
          }
        } catch {
          /* ignore */
        }
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        bytes += event.data.byteLength;
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Deepgram speak WS error (check key / network)"));
    });

    socket.addEventListener("close", () => {
      clearTimeout(timer);
      if (bytes > 0 && flushed) {
        resolve();
        return;
      }
      reject(
        new Error(`Speak incomplete: bytes=${bytes} flushed=${flushed}`),
      );
    });
  });

  console.log(`smoke-voice-tutor-speak-live: ok bytes=${bytes}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
