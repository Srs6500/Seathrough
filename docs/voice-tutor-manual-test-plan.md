# Voice Tutor — manual test plan

Full voice stack pass after the duplex / streaming work. Run these like the earlier 8 pedagogy cases: one at a time, note pass/fail + short notes.

**Not in this pass:** board circling, empty-space layout, diagram tracing / annotations (later).

---

## What we implemented (mapped to the AVM list)

| Planned | What shipped | Notes |
|---|---|---|
| Streaming Deepgram STT | Yes | Live via `/api/voice-tutor/listen-live` → Deepgram Listen WS. `utterance_end_ms` ~2.5s normal / ~1.2s post-barge; `endpointing` ~750 / ~500. Batch `/listen` fallback if browser can’t stream upload. |
| Streaming TTS | Yes | `/api/voice-tutor/speak-live` → Deepgram Speak WS → linear16 PCM; client plays chunks ASAP. Abort clears playback on barge/pause. Batch MP3 `/speak` fallback. |
| Better local VAD | Yes (Silero) | `@ricky0123/vad-web` Silero v5 for barge-in; energy RMS fallback if model/CDN fails. Not WebRTC-VAD as primary. |
| Full duplex orchestration | Yes (Pipecat-style **B**) | `VoiceDuplexSession` — shared mic, continuous listen↔speak. **Not** Deepgram Voice Agent (keeps our pedagogy/brain/board). |
| Wake word | Yes (phrase gate) | Idle ~45s → wake mode; phrases like “hey SeeThrough” / “hey tutor”. Short STT while asleep (not Porcupine / openWakeWord, no extra key). |

---

## Before you start

```bash
npm install && npm run dev
```

Optional smokes (no mic):

```bash
npm run smoke:voice-tutor-listen-live
npm run smoke:voice-tutor-speak-live
npm run smoke:voice-tutor-vad
npm run smoke:voice-tutor-duplex
npm run smoke:voice-tutor-wake
```

Open Voice Tutor, allow mic, headphones recommended (less TTS bleed).

---

## Test cases

### A. Streaming STT

| # | Case | Steps | Expect |
|---|---|---|---|
| A1 | Live partials | Mic on, speak a topic slowly | “Heard” updates while talking; turn ends after a natural pause (~2–3s), not mid-word |
| A2 | Thinking pause | Say “I wanna learn about…” then pause ~2s then finish | Does **not** cut mid-thought; waits for utterance end |
| A3 | Empty / noise | Mic on, stay silent or light keyboard | No false turn / no brain call; stays listening |
| A4 | Fallback path | (If possible) Safari or force batch) speak once | Still gets a transcript; lesson continues |

### B. Streaming TTS

| # | Case | Steps | Expect |
|---|---|---|---|
| B1 | Fast start | Mic on → greeting | Speech starts sooner than old “wait for full MP3” feel |
| B2 | Interrupt flush | During tutor speech, talk over it | Audio stops immediately; no leftover buffer playing |
| B3 | Mic off ≠ mute tutor | Turn mic off mid-lesson while tutor is about to speak | Tutor still speaks; student not heard |

### C. Silero barge-in (local VAD)

| # | Case | Steps | Expect |
|---|---|---|---|
| C1 | Snappy barge | Interrupt mid-sentence with a clear question | Cuts TTS quickly; doubt / park path still works |
| C2 | False barge | Loud keyboard / clap (not speech) during TTS | Fewer false interrupts than pure energy VAD |
| C3 | After live budget | Force 2 live doubts (partial answers), then a 3rd+ | 1st–2nd answered live (no “at the end” defer); 3rd+ parks; audio still cuts |

### D. Duplex session (continuous pipe)

| # | Case | Steps | Expect |
|---|---|---|---|
| D1 | Continuous turns | Several back-and-forth turns without toggling mic | No mic permission flicker; gaps feel smaller between turns |
| D2 | Pause (X) | Hit pause during listen or speak | Voice + transcript halt; resume only on play / resume |
| D3 | Resume | Pause → resume | Listening (or teaching) continues cleanly |
| D4 | Pedagogy intact | Topic → subtopic → teach → check | Board, clarify, check ladder unchanged (voice pipe only) |

### E. Wake word

| # | Case | Steps | Expect |
|---|---|---|---|
| E1 | Enter wake | Mic on, finish a turn, stay quiet ~45s | Orb: “Say hey SeeThrough”; random speech ignored |
| E2 | Wake phrase | Say “hey SeeThrough” or “hey tutor” | Ack “I'm here.” (if no follow-on); active listen resumes |
| E3 | Wake + command | Say “hey tutor gravity” (or similar) | Wakes and treats remainder as the user turn |
| E4 | Non-wake ignored | In wake mode, say “photosynthesis” only | No lesson turn; stays in wake |
| E5 | Pause vs wake | Pause (X) while in wake or active | Hard pause — not the same as wake sleep |

### F. Regression (from earlier 8 + fixes)

| # | Case | Steps | Expect |
|---|---|---|---|
| F1 | Clean “heard” | Speak a topic | Flash shows intent, not a messy restart trail |
| F2 | Topic lock say | Lock a topic | Rich lock line; board title is clean concept |
| F3 | Check ladder | Fail check → hints / scaffold / ending | Conversational, not robotic; repeats capped |
| F4 | Barge park + end board | Park doubts mid-lesson, finish lesson | Each parked item gets incremental close-out (≈25% → ≈25% → full) + board note |
| F5 | Dynamic subtopics | Broad topic → clarify options | Real angles, not hollow theory/apps shells |
| F6 | No Java/Megan bleed | Vague / messy speech | No unrelated topic injection from prompt examples |
| F7 | Mic off / X | As above | Mic = student mute; X = pause lesson |

---

## Pass criteria

- **Ship voice stack** if A–E mostly pass (especially barge, duplex continuity, wake, no pedagogy break).
- **Block** if: tutor doesn’t stop on barge, wake sends garbage to brain, mic-off kills TTS, or check/board flows regress.

Mark each row: `pass` / `fail` / `skip` + one-line note.
