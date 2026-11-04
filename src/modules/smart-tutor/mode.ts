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
  metaTitle: "AI Tutor with Voice and Live Diagrams",
  metaDescription:
    "Talk to a free AI tutor about any topic. SeeThrough explains out loud and draws diagrams, physics figures and 3D models on a whiteboard as it teaches.",
};
