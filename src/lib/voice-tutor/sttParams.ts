/**
 * Shared Deepgram Listen params for Voice Tutor (batch + live).
 * Keyterms bias STT toward the subject being discussed ("photosynthesis",
 * "Newton's laws") — only Nova-3 supports keyterm prompting.
 */

const MAX_KEYTERMS = 20;
const MAX_KEYTERM_CHARS = 60;

export function sanitizeKeyterms(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of raw) {
    const t = term.replace(/\s+/g, " ").trim().slice(0, MAX_KEYTERM_CHARS);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

export function applyDeepgramListenParams(
  url: URL,
  sttModel: string,
  keyterms: readonly string[],
) {
  url.searchParams.set("model", sttModel);
  url.searchParams.set("language", "en");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  if (/^nova-3/i.test(sttModel)) {
    for (const term of sanitizeKeyterms(keyterms)) {
      url.searchParams.append("keyterm", term);
    }
  }
}

/** Client: append keyterms as repeated `keyterm` query params. */
export function keytermQuery(keyterms: readonly string[] | undefined): string {
  const terms = sanitizeKeyterms(keyterms ?? []);
  return terms.map((t) => `&keyterm=${encodeURIComponent(t)}`).join("");
}
