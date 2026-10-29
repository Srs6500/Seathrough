import { searchTopicBriefing } from "@/lib/providers/tavily";
import type { LessonSourceRef } from "@/lib/voice-tutor/sessionTypes";

/**
 * Look a topic up on the web BEFORE the tutor explains it, so new products,
 * recent events, and unfamiliar names ("iPhone Duo") are taught as what they
 * really are instead of being guessed from the words.
 *
 * Fail-soft: no key / timeout / error → "" and the tutor teaches from memory.
 */

const CACHE_TTL_MS = 30 * 60_000;
export type TopicResearch = {
  /** Prompt-ready notes ("" when unavailable). */
  notes: string;
  /** Pages behind the notes — shown as hover citations on the board. */
  sources: LessonSourceRef[];
};

const EMPTY: TopicResearch = { notes: "", sources: [] };
const cache = new Map<string, { at: number; block: Promise<TopicResearch> }>();

function cacheKey(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, " ").trim();
}

async function fetchBriefing(topic: string): Promise<TopicResearch> {
  try {
    const { answer, sources } = await searchTopicBriefing(topic);
    if (!answer && !sources.length) return EMPTY;
    const used = sources.slice(0, 4);
    const lines = used.map((s) => `- ${s.title} (${s.publisher}): ${s.excerpt}`);
    return {
      notes: [answer ? `Summary: ${answer}` : "", ...lines]
        .filter(Boolean)
        .join("\n"),
      sources: used.map(({ title, url, publisher, excerpt }) => ({
        title,
        url,
        publisher,
        excerpt,
      })),
    };
  } catch (error) {
    console.warn(
      "[voice-tutor/research] lookup unavailable",
      error instanceof Error ? error.message : "search failed",
    );
    return EMPTY;
  }
}

/** Research notes + sources for `topic` (cached); empty when unavailable. */
export function researchTopic(topic: string): Promise<TopicResearch> {
  const key = cacheKey(topic);
  if (!key) return Promise.resolve(EMPTY);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.block;
  const block = fetchBriefing(topic);
  cache.set(key, { at: Date.now(), block });
  // Don't pin failures for the whole TTL.
  void block.then((b) => {
    if (!b.notes) cache.delete(key);
  });
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return block;
}

/** Prompt block that makes the model trust fresh research over its memory. */
export function researchPromptBlock(topic: string, notes: string): string {
  if (!notes) return "";
  const today = new Date().toISOString().slice(0, 10);
  return `
WEB RESEARCH on "${topic}" (fetched ${today} — newer than your training data):
${notes}
Research rules:
- Use this to decide what "${topic}" actually IS. If it names a specific product, release, event, person, or term, teach THAT real thing.
- Do NOT reinterpret the name literally from its words (e.g. a product called "Duo" is not "two of something") when the research says otherwise.
- Prefer these facts over your memory when they conflict. Don't invent specs/dates beyond what's here; say "reported" for unconfirmed details.
- Never mention "research", "search results", or sources in spoken lines.
`;
}
