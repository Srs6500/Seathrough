import type { ModeDefinition } from "@/modes/types";

/** Smart tutor: text, diagram, or physics board pedagogy. */
export const smartTutorMode: ModeDefinition = {
  id: "smart-tutor",
  href: "/smart-tutor",
  navLabel: "Smart tutor",
  title: "Smart tutor",
  description:
    "Ask a question. Text talks you through it. Diagram draws it on the board. Physics uses field diagrams and a check.",
  kind: "learning",
  group: "studio",
  order: 1,
  enabled: true,
  badge: "new",
  usesWhiteboard: true,
  metaTitle: "Smart tutor | SeeThrough",
  metaDescription:
    "Ask any question. Switch between a talk-through text lesson, a diagram lesson on the board, or a physics lesson with field diagrams.",
};
