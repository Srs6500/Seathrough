import { completeJson } from "@/lib/voice-tutor/brain";
import { pickLessonImages } from "@/lib/voice-tutor/images/pick";
import type { BeatFigure } from "@/lib/voice-tutor/images/types";
import type { VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";
import { draftsFromBeats } from "@/lib/voice-tutor/whiteboard/fromBeats";
import { layoutWhiteboard } from "@/lib/voice-tutor/whiteboard/layout";
import {
  WhiteboardDraftItemSchema,
  type WhiteboardDraftItem,
  type WhiteboardSession,
} from "@/lib/voice-tutor/whiteboard/schema";

const SYSTEM = `You are a teacher on a Zoom call writing on a whiteboard while you talk.
You get the lesson as numbered beats; each beat has the line you SAY out loud.
Write what goes on the board during each beat — short, board-style, like real teacher notes.

Return JSON: { "items": [ ... ] } where each item is
{ "id": string, "kind": "title"|"heading"|"note"|"explanation"|"formula"|"callout",
  "text": string, "beatId": string, "reveal"?: "write"|"wipe",
  "place"?: { "near"?: string, "side"?: "below"|"right" } }

Rules:
- Exactly one "title" first, on the first beat.
- Every beat gets 1–4 items. beatId must be one of the given beat ids.
- ids are short and unique ("t1", "h2", "n3"...).
- note: under 10 words, start with "• ". explanation: 1–2 plain sentences, under 30 words.
- formula: only real equations or key expressions (e.g. "F = m × a"). Plain text, no LaTeX.
- callout: one "remember this" line, under 14 words.
- Do NOT give coordinates. Use "place" only to say an item belongs next to an earlier one
  (e.g. a callout to the "right" of the explanation it sums up). "near" must be an earlier id.
- Never copy the spoken line verbatim; the board summarises what is said.`;

function beatsBlock(plan: VoiceLessonPlan): string {
  return plan.beats
    .map((beat, i) => {
      const bits = [`Beat ${i + 1} (id: ${beat.id})`, `SAY: ${beat.say}`];
      if (beat.board?.sectionLabel) bits.push(`Section: ${beat.board.sectionLabel}`);
      if (beat.board?.formalStatement) bits.push(`Statement: ${beat.board.formalStatement}`);
      if (beat.board?.keyPoints?.length) bits.push(`Key points: ${beat.board.keyPoints.join("; ")}`);
      if (beat.expectAnswer) bits.push("(This beat asks the student a question.)");
      return bits.join("\n");
    })
    .join("\n\n");
}

function parseDrafts(raw: unknown, plan: VoiceLessonPlan): WhiteboardDraftItem[] {
  const beatIds = new Set(plan.beats.map((b) => b.id));
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: unknown[] }).items)
      : [];
  const drafts: WhiteboardDraftItem[] = [];
  const ids = new Set<string>();
  for (const entry of list) {
    const parsed = WhiteboardDraftItemSchema.safeParse(entry);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (!beatIds.has(item.beatId)) continue;
    // Pictures come from the image lookup, never from the model's imagination.
    if (item.kind === "image") continue;
    // A "near" that points forward (or nowhere) would break reading order.
    if (item.place?.near && !ids.has(item.place.near)) {
      item.place = { side: item.place.side };
    }
    ids.add(item.id);
    drafts.push(item);
  }
  return drafts;
}

/**
 * Put each picture right after the first item written in its beat, asking to
 * sit to the right of it — the layout engine moves it if that spot is taken.
 */
function withFigures(drafts: WhiteboardDraftItem[], figures: BeatFigure[]): WhiteboardDraftItem[] {
  const out = [...drafts];
  figures.forEach((figure, i) => {
    const at = out.findIndex((d) => d.beatId === figure.beatId);
    const anchor = at >= 0 ? out[at] : undefined;
    const item: WhiteboardDraftItem = {
      id: `img${i + 1}`,
      kind: "image",
      text: figure.image.caption,
      beatId: figure.beatId,
      reveal: "wipe",
      image: figure.image,
      place: anchor ? { near: anchor.id, side: "right" } : undefined,
    };
    if (at >= 0) out.splice(at + 1, 0, item);
    else out.push(item);
  });
  return out;
}

/** Turn a lesson plan into a laid-out whiteboard session (exact coordinates). */
export async function generateWhiteboard(plan: VoiceLessonPlan): Promise<WhiteboardSession> {
  const beatOrder = plan.beats.map((b) => b.id);
  let drafts: WhiteboardDraftItem[] = [];
  // Pictures are looked up alongside the board draft, not after it.
  const figuresPromise = pickLessonImages(plan).catch(() => [] as BeatFigure[]);
  try {
    const raw = await completeJson({
      system: SYSTEM,
      user: `Topic: ${plan.topic}\nObjective: ${plan.objective}\n\n${beatsBlock(plan)}`,
      temperature: 0.3,
    });
    drafts = parseDrafts(raw, plan);
  } catch (error) {
    console.warn("[whiteboard] model draft failed, using lesson board content", error);
  }

  // Too thin to teach from (e.g. most beats empty) → deterministic fallback.
  const coveredBeats = new Set(drafts.map((d) => d.beatId));
  if (drafts.length < 3 || coveredBeats.size < Math.ceil(beatOrder.length / 2)) {
    drafts = draftsFromBeats(plan);
  }

  drafts = withFigures(drafts, await figuresPromise);
  return layoutWhiteboard({ topic: plan.topic, drafts, beatOrder });
}
