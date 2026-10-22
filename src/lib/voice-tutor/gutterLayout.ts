/**
 * Vertical collision resolver for diagram gutters.
 * Place each diagram near its trigger Y; if it overlaps a previous
 * placement (or reserved obstacle), nudge down by `gap`.
 */

export type GutterObstacle = {
  top: number;
  height: number;
};

export type GutterPlacementInput = {
  id: string;
  /** Preferred top (usually trigger phrase / stanza offset). */
  triggerTop: number;
  /** Estimated / measured card height. */
  height: number;
};

export type GutterPlacement = {
  id: string;
  top: number;
  height: number;
};

/**
 * Pack diagram cards into a single vertical gutter lane.
 * Obstacles are treated as already-occupied bands (e.g. tip chips).
 */
export function packGutterPlacements(
  items: GutterPlacementInput[],
  opts: {
    gap?: number;
    minTop?: number;
    obstacles?: GutterObstacle[];
  } = {},
): GutterPlacement[] {
  const gap = opts.gap ?? 16;
  const minTop = opts.minTop ?? 0;
  const occupied: GutterObstacle[] = [
    ...(opts.obstacles ?? []),
  ].map((o) => ({ ...o }));

  const out: GutterPlacement[] = [];

  for (const item of items) {
    let top = Math.max(minTop, item.triggerTop);
    const height = Math.max(40, item.height);

    // Nudge down until free of all occupied bands.
    let guard = 0;
    while (guard < 80) {
      guard += 1;
      const hit = occupied.find(
        (o) => top < o.top + o.height + gap && top + height + gap > o.top,
      );
      if (!hit) break;
      top = hit.top + hit.height + gap;
    }

    occupied.push({ top, height });
    out.push({ id: item.id, top, height });
  }

  return out;
}
