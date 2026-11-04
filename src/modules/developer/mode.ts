import type { ModeDefinition } from "@/modes/types";

/** Live office of two coding agents and their project manager. */
export const developerMode: ModeDefinition = {
  id: "developer",
  href: "/developer",
  navLabel: "Developer",
  title: "Developer floor",
  description:
    "Two agents ask Brief for work, code at their desks, and sleep when Cursor credits run out.",
  kind: "tool",
  group: "studio",
  order: 3,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Developer",
  metaDescription:
    "A visual floor of two AI developers fetching tasks from a project manager until credits reset.",
};
