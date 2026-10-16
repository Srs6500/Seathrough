import type { ModeDefinition } from "@/modes/types";

/** Whiteboard lesson player for the AI Tutor v2 FastAPI service. */
export const aiTutorV2Mode: ModeDefinition = {
  id: "ai-tutor-v2",
  href: "/ai-tutor-v2",
  navLabel: "Tutor v2",
  title: "AI Tutor v2",
  description:
    "Ask a question and watch a streamed whiteboard lesson with narration and follow-ups.",
  kind: "learning",
  group: "lab",
  order: 13,
  enabled: true,
  badge: "lab",
  usesWhiteboard: false,
  metaTitle: "AI Tutor v2 | SeeThrough",
  metaDescription:
    "Ask a question and watch a streamed whiteboard lesson from the AI Tutor v2 API.",
};
