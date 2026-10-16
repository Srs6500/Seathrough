import type { ModeDefinition } from "@/modes/types";

/** Prompt in, a canvas-rendered explanation film out. */
export const explainVideoMode: ModeDefinition = {
  id: "explain-video",
  href: "/video",
  navLabel: "Video explainer",
  title: "Video explainer",
  description: "Type a topic. A short film explains it.",
  kind: "learning",
  group: "studio",
  order: 7,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Video explainer | SeeThrough",
  metaDescription:
    "Type one topic. SeeThrough writes a short explainer film and renders it on a canvas.",
};
