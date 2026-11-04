import type { ModeDefinition } from "@/modes/types";

/** Saved Smart tutor lessons as watchable videos. */
export const dashboardMode: ModeDefinition = {
  id: "dashboard",
  href: "/dashboard",
  navLabel: "Dashboard",
  title: "Dashboard",
  description:
    "Watch lessons you saved from Smart tutor, and reopen system designs to keep editing them.",
  kind: "learning",
  group: "studio",
  order: 3,
  enabled: true,
  usesWhiteboard: false,
  metaTitle: "Dashboard",
  metaDescription:
    "Your saved Smart tutor lessons as videos, with titles you can rename.",
};
