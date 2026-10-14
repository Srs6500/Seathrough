export type BrowserLessonIntent = "concept" | "debug" | "default";

const DEBUG =
  /\b(error|exception|stack\s*trace|timeout|504|502|500|crash|bug|fail(?:ed|ure)?|debug|cross-?slot|null\s*pointer|segfault|latency|outage|incident)\b/i;

const CONCEPT =
  /\b(how\s+does|how\s+do|what\s+is|what\s+are|explain|why\s+does|why\s+is|learn|introduce|basics?|overview|define|definition)\b/i;

/** Light text heuristic — no keystroke timing. */
export function classifyBrowserIntent(prompt: string): BrowserLessonIntent {
  const q = prompt.trim();
  if (!q) return "default";
  if (DEBUG.test(q)) return "debug";
  if (CONCEPT.test(q)) return "concept";
  return "default";
}

/** Prefer a YouTube Ground phase for conceptual lessons (unless debug). */
export function shouldSeekGroundVideo(
  intent: BrowserLessonIntent,
  explicitYouTube: boolean,
): boolean {
  if (explicitYouTube) return true;
  if (intent === "debug") return false;
  return intent === "concept" || intent === "default";
}
