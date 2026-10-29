import type { ModeDefinition } from "@/modes/types";

/** Repo-Scan — dedicated repository scan workspace. */
export const repoScanMode: ModeDefinition = {
  id: "repo-scan",
  href: "/repo-scan",
  navLabel: "Repo-Scan",
  title: "Repo-Scan",
  description:
    "Connect a GitHub repo and see its tree-sitter parse.",
  kind: "learning",
  group: "studio",
  order: 6.5,
  enabled: false,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Repo-Scan | SeeThrough",
  metaDescription:
    "Connect a GitHub repository and inspect its tree-sitter parse trees.",
};
