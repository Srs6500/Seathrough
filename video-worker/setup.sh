#!/usr/bin/env bash
# One-time setup for the local explainer-video worker (macOS / Linux).
# Installs: espeak-ng + FFmpeg (system), a Python venv with Kokoro + faster-whisper,
# and warms the HyperFrames CLI, Kokoro voice model and whisper model caches.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v ffmpeg >/dev/null || ! command -v espeak-ng >/dev/null; then
  if command -v brew >/dev/null; then
    brew install ffmpeg espeak-ng
  else
    echo "Install ffmpeg and espeak-ng with your package manager, then rerun." >&2
    exit 1
  fi
fi

PY=${PYTHON:-python3}
"$PY" -c 'import sys; assert (3, 10) <= sys.version_info[:2] < (3, 13), "Kokoro needs Python 3.10-3.12"'
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q kokoro faster-whisper soundfile numpy

# Warm caches so the first video doesn't stall on downloads.
.venv/bin/python voice.py samples --text "Ready." --voices am_michael --out-dir "${TMPDIR:-/tmp}/explainer-warmup" >/dev/null
.venv/bin/python voice.py align --input "${TMPDIR:-/tmp}/explainer-warmup/am_michael.wav" >/dev/null
npx --yes hyperframes@0.8.223 doctor || true
echo "Explainer video worker ready."
