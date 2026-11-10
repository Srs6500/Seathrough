import {
  searchNewsBriefing,
  searchTopicBriefing,
} from "@/lib/providers/tavily";
import { newsTodayIso } from "@/lib/voice-tutor/images/newsFreshness";
import type { VoiceTutorStyle } from "@/lib/voice-tutor/lessonStyle";
import type { LessonSourceRef } from "@/lib/voice-tutor/sessionTypes";

/**
 * Look a topic up on the web BEFORE the tutor explains it, so new products,
 * recent events, and unfamiliar names ("iPhone Duo") are taught as what they
 * really are instead of being guessed from the words.
 *
 * Fail-soft: no key / timeout / error → "" and the tutor teaches from memory.
 */

const CACHE_TTL_MS = 30 * 60_000;
/** News moves fast — don't serve a morning briefing into the evening. */
const NEWS_CACHE_TTL_MS = 10 * 60_000;
export type TopicResearch = {
  /** Prompt-ready notes ("" when unavailable). */
  notes: string;
  /** Pages behind the notes — shown as hover citations on the board. */
  sources: LessonSourceRef[];
};

const EMPTY: TopicResearch = { notes: "", sources: [] };
const cache = new Map<string, { at: number; block: Promise<TopicResearch> }>();

function normalizeTopic(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, " ").trim();
}

function cacheKey(topic: string, style: VoiceTutorStyle): string {
  // Include the calendar day so "today's market" never reuses yesterday's cache.
  const day = style === "news" ? `:${newsTodayIso()}` : "";
  return `${style}${day}:${normalizeTopic(topic)}`;
}

async function fetchBriefing(
  topic: string,
  style: VoiceTutorStyle,
): Promise<TopicResearch> {
  try {
    const { answer, sources } =
      style === "news"
        ? await searchNewsBriefing(topic)
        : await searchTopicBriefing(topic);
    if (!answer && !sources.length) return EMPTY;
    const used = sources.slice(0, style === "news" ? 5 : 4);
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
export function researchTopic(
  topic: string,
  style: VoiceTutorStyle = "default",
): Promise<TopicResearch> {
  if (!normalizeTopic(topic)) return Promise.resolve(EMPTY);
  const key = cacheKey(topic, style);
  const ttl = style === "news" ? NEWS_CACHE_TTL_MS : CACHE_TTL_MS;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.block;
  const block = fetchBriefing(topic, style);
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
export function researchPromptBlock(
  topic: string,
  notes: string,
  style: VoiceTutorStyle = "default",
): string {
  const today = newsTodayIso();
  if (!notes) {
    if (style !== "news") return "";
    return `
NEWS RESEARCH on "${topic}" was unavailable (${today}).
News rules without live sources:
- Say clearly that live reporting was not available for ${today}.
- Do NOT invent headlines, quotes, numbers, index levels, percent moves, or causes.
- Do NOT fall back to old memory of market days.
- Offer only high-level framing the student can verify, or ask them to rephrase the event.
- Never mention "research", "search results", or APIs in spoken lines.
`;
  }
  if (style === "news") {
    return `
NEWS RESEARCH on "${topic}" (fetched ${today} — this is the source of truth for TODAY):
${notes}
News rules:
- Today is ${today}. Teach the CURRENT reported story from these notes only.
- Every number (index level, %, yield, price) MUST appear in the research above. If a figure is missing, say it was not in the latest reporting — never invent or reuse an old level from memory.
- Prefer wire services and named outlets (Reuters, AP, BBC, etc.) when attributing.
- Put short attributed quotes or paraphrases on the board ("Reuters: …"); never invent quotes.
- Prefer these facts over your memory when they conflict. Say "reported" for unconfirmed details.
- Do NOT teach a generic multi-year market history when the ask is about today / this session.
- Never mention "research", "search results", or sources by saying you searched — just teach from them.
`;
  }
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
