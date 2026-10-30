import type { ModeDefinition } from "@/modes/types";

/** Prompt in, a canvas-rendered explanation film out. Retired: /video redirects to Smart tutor. */
export const explainVideoMode: ModeDefinition = {
  id: "explain-video",
  href: "/video",
  navLabel: "Video explainer",
  title: "Video explainer",
  description: "Type an idea. Get a visual explanation worth sharing.",
  kind: "learning",
  group: "studio",
  order: 1.25,
  enabled: false,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Video explainer | SeeThrough",
  metaDescription:
    "Type an idea or paste text. Review five scenes, then get a narrated explainer you can edit and share.",
};
