import { completeJson } from "@/lib/voice-tutor/brain";
import type { VoiceTutorStyle } from "@/lib/voice-tutor/lessonStyle";
import type { VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";
import {
  newsTodayIso,
  vetNewsImages,
} from "@/lib/voice-tutor/images/newsFreshness";
import {
  findNewsImageCandidates,
  findTeachingImage,
} from "@/lib/voice-tutor/images/sources";
import type { BeatFigure, TeachingImage } from "@/lib/voice-tutor/images/types";

const MAX_IMAGES = 2;
const MAX_NEWS_IMAGES = 2;

const SYSTEM = `You decide whether a real picture would help a student understand a lesson.
Pictures help for: anatomy and organisms, cells and organelles, places and maps, historical people,
artefacts and events, machines and structures, space objects, materials, labelled scientific diagrams.
Pictures do NOT help for: abstract math, definitions of words, grammar, pure logic, opinions, code.

Return JSON: { "images": [ { "beatId": string, "wikiTitle": string, "query": string, "caption": string } ] }
- 0 to ${MAX_IMAGES} items. Return an empty list when a picture would not genuinely help.
- Pick only teaching beats, never a beat that asks the student a question.
- wikiTitle: the exact English Wikipedia article whose main image shows this (e.g. "Chloroplast", "Battle of Hastings").
- query: 2–5 words to search Wikimedia Commons for a clear, labelled image (e.g. "chloroplast structure diagram").
- caption: under 8 words, what the student is looking at.
- Never pick the same subject twice.`;

function newsSystem(today: string): string {
  return `You decide which CURRENT news photos help explain today's story on a whiteboard.
Today is ${today}.
Pictures that help: today's trading-floor / desk photo, a chart clearly labeled with today's or this week's move from a news outlet, people/places in the story right now.
Pictures that do NOT help — never request these:
- Historical index charts (e.g. "1971 to 2021", multi-decade Nasdaq/S&P history)
- Wikimedia / textbook / archival dumps
- Generic "stock market chart" queries that surface old Commons images
- Beats that only ask the student a question

Return JSON: { "images": [ { "beatId": string, "query": string, "caption": string } ] }
- 0 to ${MAX_NEWS_IMAGES} items. Prefer fewer accurate photos over any stale chart. Empty list is better than a wrong picture.
- query MUST include freshness words like "${today}", "today", or "this week", plus the concrete story nouns (ticker, index, person, place).
- Bad query: "Nasdaq composite chart". Good query: "Nasdaq today ${today} selloff Reuters" or "Wall Street trading floor today".
- caption: under 10 words, what the student is looking at right now.
- Never invent a wikiTitle. Never pick the same subject twice.`;
}

/**
 * Decide which beats deserve a real picture and fetch one from a credible
 * source for each. Returns [] when no picture helps or nothing was found.
 */
export async function pickLessonImages(
  plan: VoiceLessonPlan,
  style: VoiceTutorStyle = "default",
): Promise<BeatFigure[]> {
  const teachingBeats = plan.beats.filter((b) => !b.expectAnswer);
  if (!teachingBeats.length) return [];
  const beatIds = new Set(teachingBeats.map((b) => b.id));
  const maxImages = style === "news" ? MAX_NEWS_IMAGES : MAX_IMAGES;
  const today = newsTodayIso();

  let picks: Array<{ beatId: string; wikiTitle?: string; query: string; caption: string }> = [];
  try {
    const raw = (await completeJson({
      system: style === "news" ? newsSystem(today) : SYSTEM,
      user: `Topic: ${plan.topic}\nToday: ${today}\n\n${teachingBeats
        .map((b) => `Beat id: ${b.id}\nSAY: ${b.say}`)
        .join("\n\n")}`,
      temperature: 0.2,
    })) as { images?: unknown };
    const list = Array.isArray(raw?.images) ? raw.images : [];
    for (const entry of list) {
      const e = entry as Record<string, unknown>;
      const beatId = typeof e.beatId === "string" ? e.beatId : "";
      const query = typeof e.query === "string" ? e.query.trim() : "";
      if (!beatIds.has(beatId) || !query) continue;
      if (picks.some((p) => p.beatId === beatId)) continue;
      picks.push({
        beatId,
        query,
        wikiTitle:
          style === "news"
            ? undefined
            : typeof e.wikiTitle === "string" && e.wikiTitle.trim()
              ? e.wikiTitle.trim()
              : undefined,
        caption: typeof e.caption === "string" && e.caption.trim() ? e.caption.trim() : query,
      });
    }
  } catch (error) {
    console.warn("[voice-tutor/images] picker failed", error);
    return [];
  }
  picks = picks.slice(0, maxImages);
  if (!picks.length) return [];

  if (style === "news") {
    return pickVettedNewsFigures(plan.topic, today, picks);
  }

  const found = await Promise.all(
    picks.map(async (pick) => {
      const image = await findTeachingImage(pick, style);
      return image ? { beatId: pick.beatId, image } : null;
    }),
  );
  const seen = new Set<string>();
  return found.filter((f): f is BeatFigure => {
    if (!f || seen.has(f.image.url)) return false;
    seen.add(f.image.url);
    return true;
  });
}

/** Fetch candidates per beat, then vet the pool before anything hits the board. */
async function pickVettedNewsFigures(
  topic: string,
  today: string,
  picks: Array<{ beatId: string; query: string; caption: string }>,
): Promise<BeatFigure[]> {
  const pools = await Promise.all(
    picks.map(async (pick) => ({
      beatId: pick.beatId,
      candidates: await findNewsImageCandidates(pick),
    })),
  );

  const flat: TeachingImage[] = [];
  const seen = new Set<string>();
  for (const pool of pools) {
    for (const image of pool.candidates) {
      if (seen.has(image.url)) continue;
      seen.add(image.url);
      flat.push(image);
    }
  }

  const kept = await vetNewsImages({ topic, today, candidates: flat });
  const keptUrls = new Set(kept.map((image) => image.url));

  const figures: BeatFigure[] = [];
  const used = new Set<string>();
  for (const pool of pools) {
    const image = pool.candidates.find(
      (candidate) => keptUrls.has(candidate.url) && !used.has(candidate.url),
    );
    if (!image) continue;
    used.add(image.url);
    figures.push({ beatId: pool.beatId, image });
    if (figures.length >= MAX_NEWS_IMAGES) break;
  }
  return figures;
}
