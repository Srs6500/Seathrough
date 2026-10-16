/**
 * Format a video timestamp for speech + transcript notes.
 * Examples: 0 → "0:00", 90 → "1:30", 3725 → "1:02:05"
 */
export function formatVideoClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  }
  return `${m}:${ss}`;
}

/** True when speech already mentions an m:ss / h:mm:ss style clock. */
export function speechHasClock(speech: string): boolean {
  return /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(speech);
}

/**
 * Ensure spoken line names the seek time so transcript and TTS stay aligned.
 */
export function withSeekClock(speech: string, seconds: number): string {
  const clock = formatVideoClock(seconds);
  const trimmed = speech.trim();
  if (!trimmed) return `At ${clock} on the video.`;
  if (speechHasClock(trimmed)) return trimmed;
  // Prefer leading clock so notes scan like a transcript.
  return `At ${clock} — ${trimmed.replace(/^[—\-–]\s*/, "")}`;
}
