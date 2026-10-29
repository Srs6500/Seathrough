import type { ModeDefinition } from "@/modes/types";

/** Question-driven code flow map for nested Next.js and other indexed stacks. */
export const dataFlowMode: ModeDefinition = {
  id: "data-flow",
  href: "/data-flow",
  navLabel: "Data flow",
  title: "Data flow",
  description:
    "Paste a GitHub repo and a question to map pages → components → APIs → database.",
  kind: "learning",
  group: "studio",
  order: 5,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Data flow | SeeThrough",
  metaDescription:
    "Ask how data moves through a repo and explore the code flow map.",
};
