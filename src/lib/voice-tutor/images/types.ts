import { z } from "zod";

/**
 * A picture fetched from a credible, reusable source to help explain a topic.
 * Always carries its attribution — the board shows credit + license + link.
 */
export const TeachingImageSchema = z.object({
  /** Display URL (a ~960px rendition). */
  url: z.string().url(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Short teaching caption ("Inside a chloroplast"). */
  caption: z.string(),
  /** Accessible description of what the picture shows. */
  alt: z.string(),
  /** Author / institution, plain text. */
  credit: z.string(),
  /** e.g. "CC BY-SA 4.0", "Public domain". Empty when the source doesn't say. */
  license: z.string(),
  /** Page the image comes from (file page / article) — opened from the credit. */
  sourceUrl: z.string().url(),
  /** "Wikimedia Commons", "NASA", "nih.gov"... */
  sourceName: z.string(),
});

export type TeachingImage = z.infer<typeof TeachingImageSchema>;

/** A picture attached to one lesson beat. */
export const BeatFigureSchema = z.object({
  beatId: z.string(),
  image: TeachingImageSchema,
});

export type BeatFigure = z.infer<typeof BeatFigureSchema>;
