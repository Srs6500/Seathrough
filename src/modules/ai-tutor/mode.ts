import type { ModeDefinition } from "@/modes/types";

/** Guided tutor with playable visuals from the Python teaching loop. */
export const aiTutorMode: ModeDefinition = {
  id: "ai-tutor",
  href: "/ai-tutor",
  navLabel: "Guided tutor",
  title: "Guided tutor",
  description:
    "Ask what you want to learn. A picture shows how the idea works, then a question checks you can use it.",
  kind: "learning",
  group: "studio",
  order: 12,
  enabled: false,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Guided tutor",
  metaDescription:
    "A calm tutor that draws how an idea works and checks you understood with a new question.",
};
