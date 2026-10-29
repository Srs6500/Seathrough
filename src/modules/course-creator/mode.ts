import type { ModeDefinition } from "@/modes/types";

/** Prompt in, a shooting script out — first step of course creator. */
export const courseCreatorMode: ModeDefinition = {
  id: "course-creator",
  href: "/course-creator",
  navLabel: "Course creator",
  title: "Course creator",
  description:
    "Describe a lesson. Get a shooting script with voice, picture, and on-screen text.",
  kind: "learning",
  group: "studio",
  order: 8,
  enabled: true,
  badge: "new",
  usesWhiteboard: false,
  metaTitle: "Course creator | SeeThrough",
  metaDescription:
    "Type what a lesson should teach. SeeThrough writes it as a shooting script you can later turn into videos.",
};
