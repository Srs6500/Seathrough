import type { ModeDefinition } from "@/modes/types";

/** Course creator — retired. */
export const courseCreatorMode: ModeDefinition = {
  id: "course-creator",
  href: "/smart-tutor",
  navLabel: "Course creator",
  title: "Course creator",
  description:
    "Describe a lesson. Get a shooting script with voice, picture, and on-screen text.",
  kind: "learning",
  group: "studio",
  order: 8,
  enabled: false,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Course creator | SeeThrough",
  metaDescription:
    "Type what a lesson should teach. SeeThrough writes it as a shooting script you can later turn into videos.",
};
