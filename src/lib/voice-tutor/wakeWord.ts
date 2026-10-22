/**
 * Wake-phrase detection for Voice Tutor.
 *
 * Uses short STT windows (Silero/Deepgram path) while the duplex session is
 * in wake mode. No third-party wake-word API key — brand phrases stay ours.
 */

export const DEFAULT_WAKE_PHRASES = [
  "hey seethrough",
  "hey see through",
  "hey see-through",
  "hey tutor",
  "ok tutor",
  "okay tutor",
  "hi tutor",
] as const;

/** Collapse to lowercase alphanumeric words for matching. */
export function normalizeWakeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/see-through/g, "see through")
    .replace(/seethrough/g, "see through")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type WakeMatch = {
  matched: boolean;
  /** Phrase that matched (normalized), if any. */
  phrase: string;
  /** Words spoken after the wake phrase (may be empty). */
  remainder: string;
};

/**
 * True when the transcript contains a configured wake phrase.
 * Remainder is anything after the first match (so "hey tutor photosynthesis"
 * can continue straight into a topic).
 */
export function matchesWakePhrase(
  raw: string,
  phrases: readonly string[] = DEFAULT_WAKE_PHRASES,
): WakeMatch {
  const text = normalizeWakeText(raw);
  if (!text) return { matched: false, phrase: "", remainder: "" };

  // Prefer longer phrases first so "hey see through" wins over shorter crumbs.
  const ordered = [...phrases].sort(
    (a, b) => normalizeWakeText(b).length - normalizeWakeText(a).length,
  );

  for (const phrase of ordered) {
    const p = normalizeWakeText(phrase);
    if (!p) continue;
    if (text === p) {
      return { matched: true, phrase: p, remainder: "" };
    }
    if (text.startsWith(`${p} `)) {
      return {
        matched: true,
        phrase: p,
        remainder: text.slice(p.length).trim(),
      };
    }
    const mid = ` ${p} `;
    const at = text.indexOf(mid);
    if (at >= 0) {
      return {
        matched: true,
        phrase: p,
        remainder: text.slice(at + mid.length).trim(),
      };
    }
    if (text.endsWith(` ${p}`)) {
      return { matched: true, phrase: p, remainder: "" };
    }
  }

  // Extra fuzzy brand forms STT often produces.
  const fuzzy =
    /\bhey\s+see\s+through\b/.exec(text) ||
    /\bhey\s+tutor\b/.exec(text) ||
    /\b(?:ok|okay|hi)\s+tutor\b/.exec(text);
  if (fuzzy) {
    const phrase = fuzzy[0]!.replace(/\s+/g, " ");
    const remainder = text.slice(fuzzy.index! + fuzzy[0]!.length).trim();
    return { matched: true, phrase, remainder };
  }

  return { matched: false, phrase: "", remainder: "" };
}
