import { completeJson } from "@/lib/voice-tutor/brain";
import type { TeachingImage } from "@/lib/voice-tutor/images/types";

/** Calendar day used to ground "today" news asks (UTC date is fine for prompts). */
export function newsTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function newsTodayYear(): number {
  return new Date().getUTCFullYear();
}

/**
 * Cheap reject for archival / textbook media that often sneaks in via Commons
 * or old chart dumps when the student asked about today.
 */
export function looksStaleNewsImage(image: TeachingImage, todayYear = newsTodayYear()): boolean {
  const hay = `${image.caption} ${image.alt} ${image.credit} ${image.sourceName} ${image.sourceUrl} ${image.url}`
    .toLowerCase()
    .replace(/\u2013|\u2014/g, "-");

  if (
    /\b(wikimedia|wikipedia|commons\.wikimedia|upload\.wikimedia)\b/.test(hay) ||
    image.sourceName.toLowerCase().includes("wikimedia") ||
    image.sourceName.toLowerCase().includes("wikipedia")
  ) {
    return true;
  }

  // Explicit multi-decade / long historical ranges ending before this year.
  const range = hay.match(
    /\b((?:19|20)\d{2})\s*(?:-|to|through|until)\s*((?:19|20)\d{2})\b/,
  );
  if (range) {
    const end = Number(range[2]);
    if (Number.isFinite(end) && end < todayYear) return true;
  }

  // Captions that advertise an old single year as the chart end.
  const endYear = hay.match(
    /\b(?:as of|through|until|ending|ended|updated|data(?:\s+from)?|chart)\b[^.]{0,40}\b(20[0-2]\d|19\d{2})\b/,
  );
  if (endYear) {
    const year = Number(endYear[1]);
    if (Number.isFinite(year) && year < todayYear - 1) return true;
  }

  if (
    /\b(historical chart|since 19\d{2}|from 19\d{2}|all[- ]time chart|decades of)\b/.test(
      hay,
    )
  ) {
    return true;
  }

  return false;
}

/** Keep only images that look current enough for a News lesson. */
export function filterFreshNewsImages(images: TeachingImage[]): TeachingImage[] {
  return images.filter((image) => !looksStaleNewsImage(image));
}

/**
 * Second gate: model checks each candidate against today's date + the topic
 * before anything is drawn on the board. Fail-soft → heuristic-only keep.
 */
export async function vetNewsImages(input: {
  topic: string;
  today: string;
  candidates: TeachingImage[];
}): Promise<TeachingImage[]> {
  const fresh = filterFreshNewsImages(input.candidates);
  if (!fresh.length) return [];
  if (fresh.length === 1) {
    // Still ask — a single stale miss from heuristics should not auto-pass.
  }

  try {
    const raw = (await completeJson({
      temperature: 0,
      system: `You vet news pictures BEFORE they go on a tutor whiteboard.
Today is ${input.today}. Topic: "${input.topic}".
Keep ONLY images that could honestly illustrate THIS current story (today / this week).
Reject: historical charts ending years ago, archival Wikimedia dumps, unrelated stock photos, decade-long index charts when the ask is today's move.
Return JSON only: { "keepUrls": string[] } — subset of the given urls. Empty array is fine.`,
      user: fresh
        .map(
          (image, i) =>
            `${i + 1}. url: ${image.url}\ncaption: ${image.caption}\nalt: ${image.alt}\nsource: ${image.sourceName}\ncredit: ${image.credit}`,
        )
        .join("\n\n"),
    })) as { keepUrls?: unknown };

    const allowed = new Set(
      Array.isArray(raw.keepUrls)
        ? raw.keepUrls.filter((u): u is string => typeof u === "string" && u.startsWith("http"))
        : [],
    );
    if (!allowed.size) return [];
    return fresh.filter((image) => allowed.has(image.url));
  } catch (error) {
    console.warn(
      "[voice-tutor/images] news vet failed; using heuristic filter only",
      error instanceof Error ? error.message : "vet failed",
    );
    return fresh;
  }
}
