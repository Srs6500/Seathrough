import { completeJson } from "@/lib/voice-tutor/brain";
import type { VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";
import { findTeachingImage } from "@/lib/voice-tutor/images/sources";
import type { BeatFigure } from "@/lib/voice-tutor/images/types";

const MAX_IMAGES = 2;

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

/**
 * Decide which beats deserve a real picture and fetch one from a credible
 * source for each. Returns [] when no picture helps or nothing was found.
 */
export async function pickLessonImages(plan: VoiceLessonPlan): Promise<BeatFigure[]> {
  const teachingBeats = plan.beats.filter((b) => !b.expectAnswer);
  if (!teachingBeats.length) return [];
  const beatIds = new Set(teachingBeats.map((b) => b.id));

  let picks: Array<{ beatId: string; wikiTitle?: string; query: string; caption: string }> = [];
  try {
    const raw = (await completeJson({
      system: SYSTEM,
      user: `Topic: ${plan.topic}\n\n${teachingBeats
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
        wikiTitle: typeof e.wikiTitle === "string" && e.wikiTitle.trim() ? e.wikiTitle.trim() : undefined,
        caption: typeof e.caption === "string" && e.caption.trim() ? e.caption.trim() : query,
      });
    }
  } catch (error) {
    console.warn("[voice-tutor/images] picker failed", error);
    return [];
  }
  picks = picks.slice(0, MAX_IMAGES);

  const found = await Promise.all(
    picks.map(async (pick) => {
      const image = await findTeachingImage(pick);
      return image ? { beatId: pick.beatId, image } : null;
    }),
  );
  // The same file can be the best match for two subjects — show it once.
  const seen = new Set<string>();
  return found.filter((f): f is BeatFigure => {
    if (!f || seen.has(f.image.url)) return false;
    seen.add(f.image.url);
    return true;
  });
}
