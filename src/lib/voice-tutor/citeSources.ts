/**
 * Client-safe: pick which researched page(s) back a board sentence, by
 * keyword overlap with each source's title + excerpt (no LLM call).
 */

import type { LessonSourceRef } from "@/lib/voice-tutor/sessionTypes";

const STOP = new Set(
  "the and for with that this from into over have has had are was were been being its it's their them they than then there these those which while what when where who whom will would could should about after before because between both each more most other some such only very also just your you our out can not but all any one two new how why".split(
    " ",
  ),
);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9.\-]*/g) ?? []) {
    const w = raw.replace(/[.\-]+$/, "");
    if (w.length < 3 || STOP.has(w)) continue;
    // Light stemming so "displays" ≈ "display".
    out.add(w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);
  }
  return out;
}

export type SentenceCitation = {
  sources: LessonSourceRef[];
  /** False → no page clearly matches; shown as general lesson research. */
  specific: boolean;
};

export function citeSentence(
  sentence: string,
  sources: LessonSourceRef[] | undefined,
): SentenceCitation | null {
  if (!sources?.length) return null;
  const want = tokens(sentence);
  if (!want.size) return null;
  const scored = sources
    .map((source, index) => {
      const have = tokens(`${source.title} ${source.excerpt ?? ""}`);
      let hits = 0;
      for (const w of want) if (have.has(w)) hits += 1;
      // Numbers (specs, years) are strong evidence.
      const numHits = [...want].filter((w) => /\d/.test(w) && have.has(w)).length;
      return { source, index, score: hits + numHits };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = scored[0]!;
  if (best.score >= 2) {
    const runnerUp = scored[1];
    const picked =
      runnerUp && runnerUp.score >= 2 && runnerUp.score >= best.score - 1
        ? [best.source, runnerUp.source]
        : [best.source];
    return { sources: picked, specific: true };
  }
  return { sources: [sources[0]!], specific: false };
}
