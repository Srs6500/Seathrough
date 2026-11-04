import type { ModeDefinition } from "@/modes/types";

/** Architecture diagrams from the Excalidraw system-design library. */
export const systemDesignMode: ModeDefinition = {
  id: "system-design",
  href: "/system-design",
  navLabel: "System design",
  title: "System design",
  description:
    "Ask for a system. Each diagram stays on the board, from the architecture down to what happens when it fails.",
  kind: "learning",
  group: "studio",
  order: 4,
  enabled: true,
  usesWhiteboard: false,
  metaTitle: "System Design AI Tutor – Learn Architecture Visually",
  metaDescription:
    "Learn system design with an AI tutor that draws the architecture, data flow, requests and failure modes on one board as you ask.",
};
