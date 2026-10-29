import type { ModeDefinition } from "@/modes/types";

/** Debugger — folded into Vibe coder; keep APIs for inspect. */
export const bugAnalyzerMode: ModeDefinition = {
  id: "bug-analyzer",
  href: "/vibe-coder",
  navLabel: "Debugger",
  title: "Debugger",
  description:
    "Connect a repository, map frontend pages/components, and inspect backend bugs in the code.",
  kind: "learning",
  group: "studio",
  order: 6,
  enabled: false,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Debugger | SeeThrough",
  metaDescription:
    "Frontend architecture graph and backend bug analysis for connected GitHub repos.",
};
