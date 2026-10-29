import type { ModeDefinition } from "@/modes/types";

/**
 * High-school physics board tutor — folded into Smart tutor as ?mode=physics,
 * with electrostatics RAG + field-diagram context.
 */
export const physicsTutorMode: ModeDefinition = {
  id: "physics-tutor",
  href: "/smart-tutor?mode=physics",
  navLabel: "Physics",
  title: "Physics tutor",
  description:
    "Ask a physics question. The tutor teaches in short steps, draws field diagrams, and checks you understood.",
  kind: "learning",
  group: "studio",
  order: 1.5,
  enabled: false,
  badge: "new",
  usesWhiteboard: true,
  metaTitle: "Physics tutor | SeeThrough",
  metaDescription:
    "Ask high-school physics questions. SeeThrough draws field diagrams, talks you through them, and checks understanding.",
};
