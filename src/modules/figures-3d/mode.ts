import type { ModeDefinition } from "@/modes/types";

/** Interactive procedural anatomy figures. */
export const figures3dMode: ModeDefinition = {
  id: "figures-3d",
  href: "/3d-figures",
  navLabel: "Human anatomy",
  title: "Human anatomy",
  description:
    "Explore the heart, eye, brain, and kidney in 3D, then ask what a part does.",
  kind: "learning",
  group: "studio",
  order: 20,
  enabled: false,
  badge: "beta",
  usesWhiteboard: false,
  metaTitle: "Human anatomy",
  metaDescription:
    "Explore animated heart, eye, brain, and kidney models with clear answers.",
};
