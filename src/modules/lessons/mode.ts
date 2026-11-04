import type { ModeDefinition } from "@/modes/types";

/** Whiteboard lessons — prompt → stream → board + teacher narration. */
export const lessonsMode: ModeDefinition = {
  id: "lessons",
  href: "/lessons",
  navLabel: "Start a lesson",
  title: "Start a lesson",
  description:
    "Ask what you’re stuck on. A tutor draws it on the board and talks you through it.",
  kind: "learning",
  group: "studio",
  order: 10,
  enabled: false,
  usesWhiteboard: true,
  metaTitle: "AI Whiteboard Lessons – Ask Anything, Watch It Drawn",
  metaDescription:
    "Ask what you're stuck on and an AI tutor draws it on the board while it explains. A visual AI study tool for science, math, coding and more.",
};
