# Explainer video worker

`/explainer-videos` renders on the machine running the Next app (it is not
available on Vercel). Pipeline per video:

1. **Script**: the app's LLM writes a 30-60 s script (2-line hook, 3-7 points, closing); the person edits and approves it.
2. **Voice**: Kokoro reads hook line 1 in 3 voices; the person picks one. The whole script is then read at speed 1.1, and every truly silent pause (30 ms windows under -50 dBFS) longer than 0.24 s is cut to 0.24 s.
3. **Timing**: faster-whisper word timestamps on the final voice file, matched to the script words. Every caption word, title, stamp and gesture starts on a real word's start time.
4. **Presenter**: an SVG rig; the mouth shape per 30 fps frame comes from voice loudness (-42 dB closed, -16 dB wide open, instant attack, 0.55 release).
5. **Composition**: `src/lib/explainer-video/compose.ts` writes a HyperFrames project: one sub-composition (own GSAP timeline) per hook/point/closing, tracks paper → scenes → presenter → captions → wipes → audio.
6. **Check + review**: `hyperframes check` must report 0 errors, then snapshots of each point are shown for approval.
7. **Render + mix**: `hyperframes render`, then a two-pass FFmpeg loudnorm to -15 LUFS.

Jobs live in `.explainer-videos/<id>/` (git-ignored).

## Setup

```bash
video-worker/setup.sh
```

Installs FFmpeg + espeak-ng (Homebrew), a Python 3.10-3.12 venv in `video-worker/.venv`
with `kokoro` and `faster-whisper`, and warms the model caches (~400 MB).

## Develop

```bash
npm run explainer:dev -- vertical am_michael          # preview from scripts/explainer/fixture.json
npm run explainer:dev -- horizontal af_heart --render # full render
```

## Assets

See `assets/CREDITS.md`. Sound effects and music are CC0 or Pixabay-licensed; fonts are OFL.
`assets/grain.png` is a generated noise tile.
