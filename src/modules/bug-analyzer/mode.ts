import type { ModeDefinition } from "@/modes/types";

/** Bug Analyzer — connect a repo, then inspect issues in the code. */
export const bugAnalyzerMode: ModeDefinition = {
  id: "bug-analyzer",
  href: "/bug-analyzer",
  navLabel: "Bug analyzer",
  title: "Bug analyzer",
  description:
    "Connect a repository and find likely bugs and risky paths in the code.",
  kind: "learning",
  group: "studio",
  order: 6,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Bug analyzer | SeeThrough",
  metaDescription:
    "Connect a GitHub repository and analyze the codebase for bugs.",
};
