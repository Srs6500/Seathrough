import type { ModeDefinition } from "@/modes/types";

/** Agent-built Three.js scenes — lives on the lesson page via ?view=3d. */
export const sceneExplainMode: ModeDefinition = {
  id: "scene-explain",
  href: "/lessons?view=3d",
  navLabel: "3D scenes",
  title: "3D scene explanation",
  description:
    "Ask for osmosis, orbits, anything spatial. An agent builds a live 3D scene and explains it.",
  kind: "learning",
  group: "studio",
  order: 30,
  enabled: false,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "3D scene explanation",
  metaDescription:
    "Watch any scientific process in 3D. An agent builds the scene, repairs crashes, and explains it as it plays.",
};
