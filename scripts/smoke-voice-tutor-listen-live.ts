/**
 * Smoke: server-side Deepgram live WebSocket auth + UtteranceEnd params.
 * Does not require a mic — opens listen WS, sends CloseStream, expects clean close.
 *
 *   npm run smoke:voice-tutor-listen-live
 */
import assert from "node:assert/strict";

async function main() {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  assert.ok(apiKey, "DEEPGRAM_API_KEY missing — set in .env.local");

  const model = process.env.DEEPGRAM_STT_MODEL?.trim() || "nova-2";
  const url = new URL("wss://api.deepgram.com/v1/listen");
  url.searchParams.set("model", model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("utterance_end_ms", "1500");
  url.searchParams.set("endpointing", "750");

  await new Promise<void>((resolvePromise, reject) => {
    const socket = new WebSocket(url.toString(), ["token", apiKey]);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error("Deepgram live WS timed out"));
    }, 12_000);

    socket.addEventListener("open", () => {
      try {
        socket.send(JSON.stringify({ type: "CloseStream" }));
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });

    socket.addEventListener("message", (event) => {
      // Metadata / empty Results are fine — proves auth + streaming channel work.
      try {
        JSON.parse(String(event.data));
      } catch {
        /* ignore non-JSON */
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Deepgram live WS error (check key / network)"));
    });

    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      // 1000 normal; Deepgram sometimes uses 1005 after CloseStream.
      if (event.code === 1000 || event.code === 1005 || event.code === 1006) {
        resolvePromise();
        return;
      }
      reject(new Error(`Unexpected close code ${event.code}`));
    });
  });

  console.log("smoke-voice-tutor-listen-live: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
