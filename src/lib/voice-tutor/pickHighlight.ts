/**
 * Rank candidate spans for highlighter-circle.
 * Principle: circle what helps a *student understand the concept*,
 * not what looks important in a textbook or research paper.
 */

const META_HIGHLIGHT =
  /^(definition|definitions|conditions?|core idea|first the core idea|the definition|remember|example|examples|meaning|applies|using)$/i;

const META_CONTAINS =
  /\b(definition, then|first the core|we'll unpack|core meaning before|in your own words)\b/i;

/** Academic / paper-ish phrasing students don't need circled. */
const PAPER_ISH =
  /\b(respectively|aforementioned|herein|thus|henceforth|et al|cf\.|ibid|pursuant|notwithstanding|insofar|vis-à-vis|a priori|ceteris paribus)\b/i;

const LEARNER_FRIENDLY =
  /\b(is|are|means|means that|so that|because|for example|in short|the key|you can think of|simply|basically|in other words|happens when|used to|lets you|helps you)\b/i;

function clampWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ");
}

function scoreCandidate(
  span: string,
  topic: string,
  sourceText: string,
): number {
  const s = span.trim();
  if (s.length < 12 || s.length > 140) return -100;
  const words = s.split(/\s+/);
  if (words.length < 3 || words.length > 16) return -80;
  if (META_HIGHLIGHT.test(s)) return -200;
  if (META_CONTAINS.test(s)) return -120;
  if (PAPER_ISH.test(s)) return -90;

  let score = 0;
  const topicTokens = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const lower = s.toLowerCase();
  for (const token of topicTokens) {
    if (lower.includes(token)) score += 22;
  }

  // Student POV: prefer plain “what it is / why it matters” clauses.
  if (LEARNER_FRIENDLY.test(s)) score += 28;
  if (/\b(is|are|means)\b/i.test(s) && topicTokens.some((t) => lower.includes(t))) {
    score += 16;
  }
  if (/\b(because|so that|which means|that means)\b/i.test(s)) score += 14;
  if (/\b(for example|such as|like when)\b/i.test(s)) score += 10;

  // Prefer one breath of speech.
  if (words.length >= 4 && words.length <= 12) score += 12;

  // Mild preference for earlier explanatory sentence (concept first).
  const idx = sourceText.toLowerCase().indexOf(lower);
  if (idx >= 0 && idx < sourceText.length * 0.55) score += 8;

  // Penalize meta pedagogy and dense jargon stacks.
  if (/\b(unpack|memorize|reuse|core idea|formal statement)\b/i.test(s)) {
    score -= 45;
  }
  const longWordCount = words.filter((w) => w.length >= 11).length;
  if (longWordCount >= 3) score -= 15;

  return score;
}

function candidateSpans(sourceText: string): string[] {
  const parts = sourceText
    .split(/(?<=[.!?])\s+/)
    .flatMap((sentence) =>
      sentence.split(/(?<=;)\s+| — | – /).map((p) => p.trim()),
    )
    .filter(Boolean);

  const out: string[] = [];
  for (const part of parts) {
    const cleaned = part.replace(/^[,;:\s]+|[,;:\s]+$/g, "");
    out.push(clampWords(cleaned, 14));
    const words = cleaned.split(/\s+/);
    // Window around “is/means/because” for learner-friendly cores.
    for (let i = 0; i < words.length; i += 1) {
      if (/^(is|are|means|because)$/i.test(words[i] ?? "")) {
        const start = Math.max(0, i - 3);
        out.push(words.slice(start, start + 12).join(" "));
      }
    }
  }
  return [...new Set(out.filter(Boolean))];
}

/**
 * Pick the highest-ranked span to circle for a student learning the idea.
 */
export function pickHighlight(
  sourceText: string,
  topic: string,
  proposed?: string,
): string | undefined {
  const text = sourceText.trim();
  if (!text) return undefined;

  const proposedTrim = proposed?.trim();
  if (
    proposedTrim &&
    text.toLowerCase().includes(proposedTrim.toLowerCase()) &&
    scoreCandidate(proposedTrim, topic, text) >= 20
  ) {
    return proposedTrim;
  }

  const ranked = candidateSpans(text)
    .map((span) => ({ span, score: scoreCandidate(span, topic, text) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0] && ranked[0].score >= 0) return ranked[0].span;

  const withTopic = ranked.find((r) =>
    topic
      .toLowerCase()
      .split(/\s+/)
      .some((t) => t.length > 3 && r.span.toLowerCase().includes(t)),
  );
  return withTopic?.span || ranked[0]?.span || clampWords(text, 12);
}

export function isMetaPedagogyText(text: string): boolean {
  return (
    META_CONTAINS.test(text) ||
    /\bwe'll unpack carefully\b/i.test(text) ||
    /\bstarts with the definition, then the conditions\b/i.test(text) ||
    /\bobject, rule, or construction\b/i.test(text) ||
    /\brest of the reasoning becomes valid\b/i.test(text) ||
    /\bwhile solving a problem\b/i.test(text)
  );
}
