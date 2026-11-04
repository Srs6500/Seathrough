import type { ModeDefinition } from "@/modes/types";

/** Topic in, a narrated vertical or horizontal explainer reel out (rendered on this machine). */
export const explainerVideosMode: ModeDefinition = {
  id: "explainer-videos",
  href: "/explainer-videos",
  navLabel: "Explainer videos",
  title: "Explainer videos",
  description:
    "Give a topic. Approve the script, pick a voice, and get a 30-60 second explainer reel, vertical or horizontal.",
  kind: "learning",
  group: "studio",
  order: 1.3,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Explainer videos",
  metaDescription:
    "Turn a topic into a narrated 30-60 second explainer reel with captions and a talking presenter, vertical or horizontal.",
};
