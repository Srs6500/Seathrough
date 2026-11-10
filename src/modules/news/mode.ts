import type { ModeDefinition } from "@/modes/types";

/** News tutor: credible reporting on the board with photos and attributed quotes. */
export const newsMode: ModeDefinition = {
  id: "news",
  href: "/news",
  navLabel: "News",
  title: "News",
  description:
    "Ask what happened. The tutor pulls credible reporting, puts quotes and photos on the board, and explains why it matters.",
  kind: "learning",
  group: "studio",
  order: 1.6,
  enabled: true,
  badge: "new",
  usesWhiteboard: true,
  metaTitle: "AI News Tutor – Credible Sources on a Whiteboard",
  metaDescription:
    "Ask about current events, markets, or breaking news. SeeThrough finds credible sources, shows photos, and explains what happened and why on a whiteboard.",
};
