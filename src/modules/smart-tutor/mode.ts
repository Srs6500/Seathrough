import type { ModeDefinition } from "@/modes/types";

/** Smart tutor: voice-first lesson; text, diagrams, and physics figures as needed. */
export const smartTutorMode: ModeDefinition = {
  id: "smart-tutor",
  href: "/smart-tutor",
  navLabel: "Smart tutor",
  title: "Smart tutor",
  description:
    "Talk through a topic. The tutor writes the lesson, draws when a picture helps, and shows a physics figure when you ask physics.",
  kind: "learning",
  group: "studio",
  order: 1,
  enabled: true,
  badge: "new",
  usesWhiteboard: true,
  metaTitle: "Smart tutor | SeeThrough",
  metaDescription:
    "Ask any question by voice. SeeThrough writes the lesson on the board, sketches when it helps, and shows field diagrams for physics.",
};
