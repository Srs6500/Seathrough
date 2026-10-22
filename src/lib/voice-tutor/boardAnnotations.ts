/**
 * Normalize / validate board annotations against passage text.
 * Hard rule: targetPhrase must be an exact contiguous substring (case-insensitive
 * locate, original casing preserved). Missing phrases are skipped — never circle wrong spans.
 */

import { pickHighlight } from "@/lib/voice-tutor/pickHighlight";
import type {
  BoardAnnotation,
  BoardContent,
} from "@/lib/voice-tutor/sessionTypes";

const MAX_ANNOTATIONS = 3;
const MAX_PHRASE_WORDS = 16;
const MIN_PHRASE_CHARS = 3;

function clampWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ");
}

/** Locate needle in haystack case-insensitively; return exact slice from haystack. */
export function resolveExactPhrase(
  passage: string,
  phrase: string | undefined | null,
): string | null {
  const needle = phrase?.trim();
  if (!needle || !passage.trim()) return null;
  const hay = passage;
  const hayLower = hay.toLowerCase();
  const needleLower = needle.toLowerCase();
  const start = hayLower.indexOf(needleLower);
  if (start < 0) return null;
  const exact = hay.slice(start, start + needle.length);
  if (exact.trim().length < MIN_PHRASE_CHARS) return null;
  return clampWords(exact, MAX_PHRASE_WORDS);
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type RawAnnotationInput = {
  id?: string;
  targetPhrase?: string;
  style?: "circle" | "underline" | "both";
  sideNote?: string;
  recallQuestion?: string;
  examCue?: string;
};

/**
 * Validate annotations against passage. Drops missing phrases and overlapping spans
 * (keeps earlier). Caps at MAX_ANNOTATIONS.
 */
export function normalizeBoardAnnotations(
  passage: string,
  board: {
    annotations?: RawAnnotationInput[] | BoardAnnotation[] | null;
    highlight?: string;
    rememberTip?: string;
    examCue?: string;
    pointer?: "circle" | "arrow" | "both";
  },
): BoardAnnotation[] {
  const source = passage.trim();
  if (!source) return [];

  const raw: RawAnnotationInput[] = Array.isArray(board.annotations)
    ? board.annotations
    : [];

  // Legacy single highlight → one annotation when no multi list.
  if (!raw.length && board.highlight?.trim()) {
    raw.push({
      id: "legacy_highlight",
      targetPhrase: board.highlight,
      style:
        board.pointer === "circle"
          ? "circle"
          : board.pointer === "arrow"
            ? "underline"
            : "both",
      sideNote: board.rememberTip?.trim() || "Hold onto this — you'll reuse it.",
      examCue: board.examCue,
    });
  }

  const out: BoardAnnotation[] = [];
  const usedRanges: Array<{ start: number; end: number }> = [];
  const hayLower = source.toLowerCase();

  for (let i = 0; i < raw.length; i += 1) {
    if (out.length >= MAX_ANNOTATIONS) break;
    const item = raw[i]!;
    const exact = resolveExactPhrase(source, item.targetPhrase);
    if (!exact) continue;
    const sideNote = (item.sideNote ?? "").trim();
    if (!sideNote) continue;

    const start = hayLower.indexOf(exact.toLowerCase());
    if (start < 0) continue;
    const end = start + exact.length;
    if (usedRanges.some((r) => rangesOverlap(r.start, r.end, start, end))) {
      continue;
    }
    usedRanges.push({ start, end });

    const style =
      item.style === "circle" || item.style === "underline" || item.style === "both"
        ? item.style
        : "both";

    out.push({
      id: (item.id?.trim() || `ann_${i + 1}`).slice(0, 48),
      targetPhrase: exact,
      style,
      sideNote: sideNote.slice(0, 220),
      recallQuestion: item.recallQuestion?.trim().slice(0, 220) || undefined,
      examCue: item.examCue?.trim().slice(0, 220) || undefined,
    });
  }

  return out;
}

/** Build at least one annotation from highlight / pickHighlight when possible. */
export function buildBoardAnnotations(input: {
  sourceText: string;
  topic: string;
  highlight?: string;
  rememberTip?: string;
  examCue?: string;
  annotations?: RawAnnotationInput[] | BoardAnnotation[];
  pointer?: "circle" | "arrow" | "both";
}): BoardAnnotation[] {
  const source = input.sourceText.trim();
  if (!source) return [];

  const fromList = normalizeBoardAnnotations(source, {
    annotations: input.annotations,
    highlight: input.highlight,
    rememberTip: input.rememberTip,
    examCue: input.examCue,
    pointer: input.pointer,
  });
  if (fromList.length) return fromList;

  const picked =
    resolveExactPhrase(source, input.highlight) ||
    resolveExactPhrase(source, pickHighlight(source, input.topic, input.highlight));
  if (!picked) return [];

  return normalizeBoardAnnotations(source, {
    highlight: picked,
    rememberTip:
      input.rememberTip?.trim() ||
      `Keep this piece about ${input.topic} — you'll apply it when answering.`,
    examCue: input.examCue,
    pointer: input.pointer ?? "both",
  });
}

/**
 * Attach normalized annotations to a board. Syncs legacy `highlight` to the
 * first annotation phrase for older UI paths.
 */
export function withNormalizedAnnotations(
  board: BoardContent,
  topic: string,
): BoardContent {
  const source = board.sourceText?.trim() || "";
  if (!source) {
    return { ...board, annotations: board.annotations?.length ? [] : board.annotations };
  }

  const annotations = buildBoardAnnotations({
    sourceText: source,
    topic,
    highlight: board.highlight,
    rememberTip: board.rememberTip,
    examCue: board.examCue,
    annotations: board.annotations,
    pointer: board.pointer,
  });

  if (!annotations.length) {
    return { ...board, annotations: undefined };
  }

  const primary = annotations[0]!;
  return {
    ...board,
    annotations,
    highlight: primary.targetPhrase,
    rememberTip: board.rememberTip?.trim() || primary.sideNote,
    examCue: board.examCue?.trim() || primary.examCue,
    pointer: board.pointer || "both",
  };
}
