import type { VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";
import type { WhiteboardDraftItem } from "@/lib/voice-tutor/whiteboard/schema";

function firstSentences(text: string, max: number): string {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]?/g) ?? [text];
  return parts.slice(0, max).join(" ").trim();
}

/**
 * Deterministic whiteboard drafts built from the lesson plan's own board
 * content. Used when the model is unavailable or returns nothing usable.
 */
export function draftsFromBeats(plan: VoiceLessonPlan): WhiteboardDraftItem[] {
  const drafts: WhiteboardDraftItem[] = [];
  const first = plan.beats[0];
  if (!first) return drafts;

  drafts.push({ id: "title", kind: "title", text: plan.label || plan.topic, beatId: first.id });

  plan.beats.forEach((beat, b) => {
    const board = beat.board;
    const prefix = `b${b + 1}`;
    if (board?.sectionLabel) {
      drafts.push({ id: `${prefix}_h`, kind: "heading", text: board.sectionLabel, beatId: beat.id });
    }
    if (board?.formalStatement && b > 0) {
      drafts.push({ id: `${prefix}_f`, kind: "formula", text: board.formalStatement, beatId: beat.id });
    }
    const explain = board?.plainExplain || (board?.sourceText ? firstSentences(board.sourceText, 2) : "");
    if (explain) {
      drafts.push({ id: `${prefix}_e`, kind: "explanation", text: explain, beatId: beat.id });
    }
    (board?.keyPoints ?? []).slice(0, 3).forEach((point, i) => {
      drafts.push({ id: `${prefix}_n${i + 1}`, kind: "note", text: `• ${point}`, beatId: beat.id });
    });
    const tip = board?.rememberTip;
    if (tip) {
      drafts.push({ id: `${prefix}_c`, kind: "callout", text: tip, beatId: beat.id, place: { side: "right" } });
    }
    // Beats with no board content still get a line, so the board never stalls.
    if (!board && !beat.expectAnswer) {
      drafts.push({ id: `${prefix}_n`, kind: "note", text: `• ${firstSentences(beat.say, 1)}`, beatId: beat.id });
    }
    if (beat.expectAnswer) {
      drafts.push({ id: `${prefix}_q`, kind: "callout", text: `Your turn: ${firstSentences(beat.say, 1)}`, beatId: beat.id });
    }
  });

  return drafts;
}
