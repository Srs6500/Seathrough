# Voice Tutor — test cases (manual)

Same style as the earlier pedagogy pass: do each case, note pass/fail.

**Out of scope:** circling, empty-space board layout, diagram tracing (later).

**Setup:** `npm install && npm run dev` → open Voice Tutor → allow mic (headphones help).

---

### 1. Streaming listen (STT)
**How:** Mic on. Speak a topic slowly, then pause. Try once with a mid-sentence pause (“I wanna learn about…” → wait ~2s → finish).
**Expect:** “Heard” updates while you talk. Turn doesn’t cut mid-thought. After a natural pause (~2–3s), tutor responds.

### 2. Streaming speak (TTS)
**How:** Mic on → let greeting play. Mid-sentence, talk over the tutor.
**Expect:** Speech starts quickly. Interrupt stops audio immediately (no leftover playback).

### 3. Mic off ≠ mute tutor
**How:** During or right before a tutor line, turn mic off.
**Expect:** Tutor still speaks. You are not heard until mic is back on.

### 4. Silero barge-in
**How:** Interrupt mid-lesson with a clear doubt. Also try keyboard noise (not speech) during TTS. Ask 4–5 doubts mid-lesson.
**Expect:** Real speech cuts TTS snappily. Fewer false barges from non-speech noise. First **2** doubts get a live partial answer (not “I’ll cover that at the end”). Doubts **3+** park for end. Every parked doubt is answered at close-out with incremental reveal (≈25% → ≈25% → full if needed).

### 5. Duplex continuity
**How:** Several back-and-forth turns without toggling mic. Then hit X (pause) → resume.
**Expect:** No mic flicker between turns. Pause halts voice + transcript; resume continues cleanly. Board / check / clarify still work (pedagogy unchanged).

### 6. Wake word
**How:** After a turn, stay quiet ~45s until orb says “Say hey SeeThrough”. Say random words (should ignore). Then say “hey SeeThrough” or “hey tutor”. Optional: “hey tutor gravity”.
**Expect:** Wake mode ignores non-wake speech. Wake → “I'm here.” (if no follow-on). Wake + topic continues into a normal turn.

### 7. Heard + topic lock hygiene
**How:** Ask for a topic; lock it; watch board title + spoken lock line.
**Expect:** “Heard” is clean intent (not a messy restart trail). Lock line / board title are the concept, not raw query spam.

### 8. Check ladder
**How:** Hit a check question; fail / ask to repeat / half-answer.
**Expect:** Conversational hints/scaffold; repeat capped; ending doesn’t feel robotic.

### 9. Barge park → end board
**How:** Mid-teach, barge with doubts past the live cap (3+); finish the lesson.
**Expect:** After cap, audio still cuts but doubts park; at end each parked item gets voice + board, with incremental scaffold (student can nail it early).

### 10. Subtopics + no bleed
**How:** Broad topic → pick among options. Also try vague/messy speech (“random things”).
**Expect:** Real subtopic angles (not hollow theory/apps shells). No Java/Megan-style unrelated injection.

---

## Quick pass bar
Ship if 1–6 feel solid and 7–10 don’t regress. Fail hard if: barge doesn’t stop TTS, wake feeds garbage to the brain, mic-off kills tutor audio, or check/board flows break.
