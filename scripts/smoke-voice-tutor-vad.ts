/**
 * Smoke: Silero VAD package exports load in Node (browser warm uses CDN assets).
 *
 *   npm run smoke:voice-tutor-vad
 */
import assert from "node:assert/strict";

async function main() {
  const vad = await import("@ricky0123/vad-web");
  assert.equal(typeof vad.MicVAD?.new, "function");
  assert.equal(typeof vad.getDefaultRealTimeVADOptions, "function");
  const defaults = vad.getDefaultRealTimeVADOptions("v5");
  assert.ok(defaults.positiveSpeechThreshold > 0);
  assert.ok(defaults.positiveSpeechThreshold < 1);
  console.log(
    `smoke-voice-tutor-vad: ok model=v5 threshold=${defaults.positiveSpeechThreshold}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
