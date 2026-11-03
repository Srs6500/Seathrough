import type { WordTiming } from "@/lib/explainer-video/types";

/** One script word with the real spoken time it was matched to. */
export type TimedWord = {
  text: string;
  norm: string;
  line: number;
  start: number;
  end: number;
};

export type TimedLine = { words: TimedWord[]; start: number; end: number };

export function normWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Same word, allowing plurals and short stems ("eye"/"eyes", "perceive"/"perception"). */
export function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const stem = (w: string) => w.replace(/(ies|es|s|ed|ing|ion|ly)$/, "");
  const sa = stem(a);
  const sb = stem(b);
  if (sa === sb) return true;
  const n = Math.min(sa.length, sb.length);
  return n >= 5 && sa.slice(0, n) === sb.slice(0, n);
}

/**
 * Match script words to whisper words (longest common subsequence on
 * normalised tokens). Script words whisper heard differently ("seventy" vs
 * "70") take the whisper words in the same gap, in order, so every word still
 * carries a real spoken start time, never an interpolated guess.
 */
export function alignScript(lines: string[], heard: WordTiming[], offset = 0): TimedLine[] {
  const script = lines.flatMap((line, li) =>
    line
      .split(/\s+/)
      .filter((w) => normWord(w))
      .map((text) => ({ text, norm: normWord(text), line: li })),
  );
  const spoken = heard
    .map((w) => ({ ...w, norm: normWord(w.word) }))
    .filter((w) => w.norm);
  if (!spoken.length) throw new Error("The voice track had no recognisable words.");

  const n = script.length;
  const m = spoken.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        script[i]!.norm === spoken[j]!.norm
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const match = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (script[i]!.norm === spoken[j]!.norm) {
      match[i] = j;
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i += 1;
    else j += 1;
  }

  // Fill each unmatched run of script words from the whisper words in its gap.
  for (let i = 0; i < n; ) {
    if (match[i] !== -1) {
      i += 1;
      continue;
    }
    let k = i;
    while (k < n && match[k] === -1) k += 1;
    const lo = i > 0 ? match[i - 1]! + 1 : 0;
    const hi = k < n ? match[k]! : m; // exclusive
    const gap = hi - lo;
    for (let s = i; s < k; s += 1) {
      if (gap > 0) {
        match[s] = lo + Math.min(gap - 1, Math.floor(((s - i) * gap) / (k - i)));
      } else {
        // Nothing heard in between: share the neighbour's real start.
        match[s] = Math.min(m - 1, k < n ? match[k]! : Math.max(0, lo - 1));
      }
    }
    i = k;
  }

  const timed: TimedWord[] = script.map((w, i) => {
    const hit = spoken[match[i]!]!;
    return { ...w, start: hit.start + offset, end: hit.end + offset };
  });
  // Keep starts monotonic so cues never run backwards.
  for (let i = 1; i < timed.length; i += 1) {
    if (timed[i]!.start < timed[i - 1]!.start) timed[i]!.start = timed[i - 1]!.start;
    if (timed[i]!.end < timed[i]!.start) timed[i]!.end = timed[i]!.start;
  }

  return lines.map((_, li) => {
    const words = timed.filter((w) => w.line === li);
    if (!words.length) throw new Error(`Line ${li + 1} of the script was not heard.`);
    return { words, start: words[0]!.start, end: words[words.length - 1]!.end };
  });
}

/** Real start time of `word` (or its first token) in a line, else the line start. */
export function wordStart(line: TimedLine, word: string, after = -Infinity): number {
  const first = normWord(word.split(/\s+/)[0] ?? "");
  const hit =
    line.words.find((w) => w.norm === first && w.start >= after) ??
    line.words.find((w) => sameWord(w.norm, first) && w.start >= after);
  return hit?.start ?? line.words.find((w) => w.start >= after)?.start ?? line.start;
}
