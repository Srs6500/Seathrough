/**
 * Offline smoke for VoiceDuplexSession state helpers (no mic).
 *
 *   npm run smoke:voice-tutor-duplex
 */
import assert from "node:assert/strict";
import { VoiceDuplexSession } from "../src/lib/voice-tutor/duplexSession";

async function main() {
  const states: string[] = [];
  const session = new VoiceDuplexSession({
    onState: (s) => states.push(s),
  });

  assert.equal(session.duplexState, "idle");
  assert.equal(session.speaking, false);
  assert.equal(session.hasMic, false);

  session.setPostBarge(true);
  session.pause();
  assert.equal(session.duplexState, "paused");
  assert.ok(states.includes("paused"));

  // Without a mic, resumeListening should idle (student still muted by default).
  session.resumeListening();
  assert.equal(session.duplexState, "idle");

  // Wake mode without mic should no-op safely (muted / no stream).
  session.enterWakeMode();
  assert.equal(session.isWakeMode, false);

  session.destroy();
  assert.equal(session.duplexState, "ended");
  assert.equal(session.hasMic, false);

  // Destroy is idempotent.
  session.destroy();
  assert.equal(session.duplexState, "ended");

  console.log("smoke-voice-tutor-duplex: ok", states.join("->"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
