"""Voice worker for explainer videos: Kokoro speech, pause trimming, word
timings, mouth envelope and SFX peak offsets.

Run with the worker venv:  video-worker/.venv/bin/python video-worker/voice.py <cmd> ...
Every command prints one JSON object on stdout (logs go to stderr).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 24_000
# Pauses: 30 ms loudness windows, anything this quiet counts as truly silent.
WINDOW_S = 0.03
SILENCE_DB = -50.0
MAX_PAUSE_S = 0.24
# Mouth: 30 fps, -42 dB closed, -16 dB wide open, 10 shapes.
FPS = 30
MOUTH_CLOSED_DB = -42.0
MOUTH_OPEN_DB = -16.0
MOUTH_SHAPES = 10
RELEASE = 0.55


def log(*parts: object) -> None:
    print(*parts, file=sys.stderr, flush=True)


def db(x: np.ndarray) -> float:
    rms = float(np.sqrt(np.mean(np.square(x)))) if x.size else 0.0
    return 20.0 * np.log10(max(rms, 1e-9))


def load_mono(path: str) -> tuple[np.ndarray, int]:
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    return audio.mean(axis=1), rate


# --- speech -----------------------------------------------------------------

_pipelines: dict[str, object] = {}


def kokoro_pipeline(voice: str):
    from kokoro import KPipeline

    lang = voice[0]  # af_heart -> "a" (American), bm_george -> "b" (British)
    if lang not in _pipelines:
        _pipelines[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    return _pipelines[lang]


def synthesize(text: str, voice: str, speed: float) -> np.ndarray:
    pipeline = kokoro_pipeline(voice)
    chunks = []
    # One line per script beat keeps a natural breath between them; trim() cuts it to size.
    for result in pipeline(text, voice=voice, speed=speed, split_pattern=r"\n+"):
        audio = result.audio if hasattr(result, "audio") else result[2]
        if audio is not None:
            chunks.append(np.asarray(audio, dtype=np.float32))
    if not chunks:
        raise RuntimeError("Kokoro returned no audio")
    return np.concatenate(chunks)


def cmd_speak(args: argparse.Namespace) -> dict:
    text = Path(args.text_file).read_text() if args.text_file else args.text
    audio = synthesize(text, args.voice, args.speed)
    sf.write(args.out, audio, SAMPLE_RATE)
    return {"out": args.out, "duration": len(audio) / SAMPLE_RATE}


def cmd_samples(args: argparse.Namespace) -> dict:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    samples = []
    for voice in args.voices.split(","):
        audio = trim_pauses(synthesize(args.text, voice, args.speed), SAMPLE_RATE)
        path = out_dir / f"{voice}.wav"
        sf.write(path, audio, SAMPLE_RATE)
        samples.append({"voice": voice, "file": str(path), "duration": len(audio) / SAMPLE_RATE})
    return {"samples": samples}


# --- pauses -----------------------------------------------------------------


def trim_pauses(audio: np.ndarray, rate: int) -> np.ndarray:
    """Cut every silent run longer than MAX_PAUSE_S down to MAX_PAUSE_S."""
    win = int(round(WINDOW_S * rate))
    n = len(audio) // win
    silent = [db(audio[i * win : (i + 1) * win]) < SILENCE_DB for i in range(n)]
    keep = []
    i = 0
    while i < n:
        j = i
        while j < n and silent[j] == silent[i]:
            j += 1
        start, end = i * win, j * win
        if silent[i] and (end - start) > MAX_PAUSE_S * rate:
            half = int(MAX_PAUSE_S * rate / 2)
            # Leading/trailing silence of the file is cut the same way.
            keep.append(audio[start : start + half])
            keep.append(audio[end - half : end])
        else:
            keep.append(audio[start:end])
        i = j
    keep.append(audio[n * win :])
    return np.concatenate(keep)


def cmd_trim(args: argparse.Namespace) -> dict:
    audio, rate = load_mono(args.input)
    out = trim_pauses(audio, rate)
    sf.write(args.out, out, rate)
    return {"out": args.out, "before": len(audio) / rate, "duration": len(out) / rate}


# --- word timings -----------------------------------------------------------


def cmd_align(args: argparse.Namespace) -> dict:
    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    # Decode with FFmpeg: faster-whisper's own PyAV decoder breaks on newer PyAV.
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", args.input, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        check=True,
        capture_output=True,
    ).stdout
    segments, _ = model.transcribe(
        np.frombuffer(pcm, dtype=np.float32),
        language="en",
        word_timestamps=True,
        initial_prompt=args.prompt or None,
        vad_filter=False,
    )
    words = []
    for segment in segments:
        for w in segment.words or []:
            text = w.word.strip()
            if text:
                words.append({"word": text, "start": round(w.start, 3), "end": round(w.end, 3)})
    return {"words": words}


# --- mouth ------------------------------------------------------------------


def mouth_frames(audio: np.ndarray, rate: int) -> list[int]:
    hop = rate / FPS
    frames = int(np.ceil(len(audio) / hop))
    level = 0.0
    out = []
    for f in range(frames):
        a, b = int(f * hop), int((f + 1) * hop)
        target = (db(audio[a:b]) - MOUTH_CLOSED_DB) / (MOUTH_OPEN_DB - MOUTH_CLOSED_DB)
        target = min(1.0, max(0.0, target))
        # Instant attack, 0.55 release per frame.
        level = target if target >= level else level + (target - level) * RELEASE
        out.append(int(round(level * (MOUTH_SHAPES - 1))))
    return out


def cmd_mouth(args: argparse.Namespace) -> dict:
    audio, rate = load_mono(args.input)
    return {"fps": FPS, "frames": mouth_frames(audio, rate)}


# --- sfx --------------------------------------------------------------------


def cmd_peaks(args: argparse.Namespace) -> dict:
    """Seconds from each file's start to its loudest 10 ms."""
    peaks = {}
    for path in args.files:
        audio, rate = load_mono(path)
        win = max(1, int(rate * 0.01))
        n = max(1, len(audio) // win)
        energy = [float(np.mean(np.square(audio[i * win : (i + 1) * win]))) for i in range(n)]
        peaks[Path(path).name] = {
            "peak": round(int(np.argmax(energy)) * win / rate, 3),
            "duration": round(len(audio) / rate, 3),
        }
    return {"peaks": peaks}


# --- full pass --------------------------------------------------------------


def cmd_voice(args: argparse.Namespace) -> dict:
    """speak -> trim -> mouth in one process (model loads once)."""
    text = Path(args.text_file).read_text()
    raw = synthesize(text, args.voice, args.speed)
    sf.write(Path(args.out).with_suffix(".raw.wav"), raw, SAMPLE_RATE)
    audio = trim_pauses(raw, SAMPLE_RATE)
    sf.write(args.out, audio, SAMPLE_RATE)
    return {
        "out": args.out,
        "rawDuration": len(raw) / SAMPLE_RATE,
        "duration": len(audio) / SAMPLE_RATE,
        "fps": FPS,
        "mouth": mouth_frames(audio, SAMPLE_RATE),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("speak")
    p.add_argument("--text")
    p.add_argument("--text-file")
    p.add_argument("--voice", default="af_heart")
    p.add_argument("--speed", type=float, default=1.1)
    p.add_argument("--out", required=True)

    p = sub.add_parser("samples")
    p.add_argument("--text", required=True)
    p.add_argument("--voices", required=True)
    p.add_argument("--speed", type=float, default=1.1)
    p.add_argument("--out-dir", required=True)

    p = sub.add_parser("trim")
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)

    p = sub.add_parser("align")
    p.add_argument("--input", required=True)
    p.add_argument("--model", default="small.en")
    p.add_argument("--prompt", default="")

    p = sub.add_parser("mouth")
    p.add_argument("--input", required=True)

    p = sub.add_parser("peaks")
    p.add_argument("files", nargs="+")

    p = sub.add_parser("voice")
    p.add_argument("--text-file", required=True)
    p.add_argument("--voice", default="af_heart")
    p.add_argument("--speed", type=float, default=1.1)
    p.add_argument("--out", required=True)

    args = parser.parse_args()
    handler = {
        "speak": cmd_speak,
        "samples": cmd_samples,
        "trim": cmd_trim,
        "align": cmd_align,
        "mouth": cmd_mouth,
        "peaks": cmd_peaks,
        "voice": cmd_voice,
    }[args.cmd]
    result = handler(args)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
