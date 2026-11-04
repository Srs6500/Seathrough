import type { ModeDefinition } from "@/modes/types";

/** Live browser tutor — search, open a credible page, highlight & explain. */
export const browserExperienceMode: ModeDefinition = {
  id: "browser-experience",
  href: "/browser",
  navLabel: "Browser",
  title: "Browser experience",
  description:
    "Ask a question. We open a real browser, search, open a credible page, and explain by highlighting on the page.",
  kind: "learning",
  group: "studio",
  order: 2,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "AI Study Browser – Learn from Real Sources",
  metaDescription:
    "Ask any question. SeeThrough opens a live browser, finds a credible source, and explains it by highlighting the page as it reads.",
};
