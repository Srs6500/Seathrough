import type { ModeDefinition } from "@/modes/types";

/** Debugger — frontend architecture graph + backend static analysis. */
export const bugAnalyzerMode: ModeDefinition = {
  id: "bug-analyzer",
  href: "/bug-analyzer",
  navLabel: "Debugger",
  title: "Debugger",
  description:
    "Connect a repository, map frontend pages/components, and inspect backend bugs in the code.",
  kind: "learning",
  group: "studio",
  order: 6,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Debugger | SeeThrough",
  metaDescription:
    "Frontend architecture graph and backend bug analysis for connected GitHub repos.",
};
