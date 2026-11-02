import { z } from "zod";
import { TeachingImageSchema } from "@/lib/voice-tutor/images/types";

/**
 * Whiteboard lesson JSON.
 *
 * The model writes *drafts* (content + a loose placement hint). The layout
 * engine turns drafts into *items* with exact board coordinates, checking every
 * earlier item's box so nothing ever overlaps.
 */

/** Logical board width. The board scales to fit; height grows with content. */
export const WHITEBOARD_WIDTH = 1600;
export const WHITEBOARD_MARGIN = 64;
/** Minimum empty space kept between any two items. */
export const WHITEBOARD_GAP = 28;

export const WhiteboardKindSchema = z.enum([
  /** Big lesson title, underlined after it's written. */
  "title",
  /** Section label: "Definition", "Example", ... */
  "heading",
  /** Short bullet note. */
  "note",
  /** 1–3 plain sentences explaining an idea. */
  "explanation",
  /** Equation / key expression, written large. */
  "formula",
  /** Boxed "remember this" takeaway. */
  "callout",
  /** Real picture from a credible source; `text` is its caption. */
  "image",
]);

export type WhiteboardKind = z.infer<typeof WhiteboardKindSchema>;

export const WhiteboardRevealSchema = z.enum([
  /** Pen writes it line by line, cursor rides the pen tip. */
  "write",
  /** Cursor sweeps across and the block wipes into view. */
  "wipe",
]);

export type WhiteboardReveal = z.infer<typeof WhiteboardRevealSchema>;

export const WhiteboardPlacementSchema = z.object({
  /** Id of an earlier item to sit next to. */
  near: z.string().optional(),
  side: z.enum(["below", "right"]).default("below"),
});

/** What the model returns: content and intent, no coordinates. */
export const WhiteboardDraftItemSchema = z.object({
  id: z.string().min(1),
  kind: WhiteboardKindSchema,
  text: z.string().min(1),
  /** Which lesson beat this is written during (synced to that beat's voice). */
  beatId: z.string().min(1),
  reveal: WhiteboardRevealSchema.optional(),
  place: WhiteboardPlacementSchema.optional(),
  /** Only for kind "image". */
  image: TeachingImageSchema.optional(),
});

export type WhiteboardDraftItem = z.infer<typeof WhiteboardDraftItemSchema>;

/** A laid-out item: exact box on the board plus pre-wrapped lines. */
export const WhiteboardItemSchema = WhiteboardDraftItemSchema.extend({
  reveal: WhiteboardRevealSchema,
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  fontSize: z.number(),
  lineHeight: z.number(),
  /** Text already wrapped to fit `w` — render these lines exactly. */
  lines: z.array(z.string()),
  /** Position in the lesson (beat order) — the reveal queue follows it. */
  beatIndex: z.number().int(),
  /** kind "image": picture frame inside the box (caption + credit sit below). */
  frame: z.object({ w: z.number(), h: z.number() }).optional(),
});

export type WhiteboardItem = z.infer<typeof WhiteboardItemSchema>;

export const WhiteboardSessionSchema = z.object({
  topic: z.string(),
  board: z.object({ width: z.number(), height: z.number() }),
  items: z.array(WhiteboardItemSchema),
});

export type WhiteboardSession = z.infer<typeof WhiteboardSessionSchema>;
