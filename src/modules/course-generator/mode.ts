import type { ModeDefinition } from "@/modes/types";

/** Course generator: intake → outline → lazy whiteboard / notes / questions. */
export const courseGeneratorMode: ModeDefinition = {
  id: "course-generator",
  href: "/course-generator",
  navLabel: "Course generator",
  title: "Course generator",
  description:
    "Describe what you want to learn. Answer a few questions, get a course of whiteboard lessons, notes, and practice — each piece builds when you open it.",
  kind: "learning",
  group: "studio",
  order: 1.7,
  enabled: false,
  badge: "new",
  usesWhiteboard: true,
  metaTitle: "AI Course Generator – Lessons, Notes, and Practice",
  metaDescription:
    "Describe a topic, answer a short intake, and get a custom course. Whiteboard lessons, written notes, and questions generate when you open each unit — later units use what you already covered.",
};
