import type { ModeDefinition } from "@/modes/types";

/** Screenshot → vision/OCR extract → same whiteboard lesson stream. */
export const screenshotExplainMode: ModeDefinition = {
  id: "screenshot-explain",
  href: "/image-explain",
  navLabel: "Photo",
  title: "From a photo",
  description: "Upload homework or notes. We’ll read it and teach it on the board.",
  kind: "learning",
  group: "more",
  order: 40,
  enabled: false,
  badge: "new",
  usesWhiteboard: true,
  metaTitle: "From a photo",
  metaDescription:
    "Upload a homework screenshot and get a step-by-step whiteboard explanation.",
};
