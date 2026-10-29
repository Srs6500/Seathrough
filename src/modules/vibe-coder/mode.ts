import type { ModeDefinition } from "@/modes/types";

export const vibeCoderMode: ModeDefinition = {
  id: "vibe-coder",
  href: "/vibe-coder",
  navLabel: "Vibe coder",
  title: "Vibe coder",
  description:
    "Connect a GitHub repo and start with the database — what each table is for, and which code writes it.",
  kind: "learning",
  group: "studio",
  order: 6.2,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Vibe coder | SeeThrough",
  metaDescription:
    "An interactive guide to the application you built, starting with the database.",
};
