import type { ModeDefinition } from "@/modes/types";

/** Question-driven code flow map for TypeScript + Next.js repos. */
export const dataFlowMode: ModeDefinition = {
  id: "data-flow",
  href: "/data-flow",
  navLabel: "Data flow",
  title: "Data flow",
  description:
    "Paste a GitHub repo and a question to map pages → components → APIs → database in Next.js.",
  kind: "learning",
  group: "studio",
  order: 5,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Data flow | SeeThrough",
  metaDescription:
    "Ask how data moves through a TypeScript Next.js repo and explore the code flow map.",
};
