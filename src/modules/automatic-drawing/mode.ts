import type { ModeDefinition } from "@/modes/types";

/** Lab: prompt-driven automatic drawing whiteboard. */
export const automaticDrawingMode: ModeDefinition = {
  id: "automatic-drawing",
  href: "/automatic-drawing",
  navLabel: "Auto Draw",
  title: "Automatic Drawing",
  description: "Prompt the whiteboard and watch a drawing plan execute.",
  kind: "tool",
  group: "lab",
  order: 100,
  enabled: false,
  badge: "lab",
  usesWhiteboard: true,
  metaTitle: "Automatic Drawing",
  metaDescription: "Prompt SeeThrough’s whiteboard and watch it draw automatically.",
};
