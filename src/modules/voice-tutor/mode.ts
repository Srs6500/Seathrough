import type { ModeDefinition } from "@/modes/types";

/** Voice-led Socratic tutor (SLR lesson engine) under the Smart Tutor family. */
export const voiceTutorMode: ModeDefinition = {
  id: "voice-tutor",
  href: "/smart-tutor?mode=text",
  navLabel: "Voice tutor",
  title: "Voice tutor",
  description:
    "Voice-first tutoring — pick any topic, lock in, learn by talking. Diagrams appear when they help.",
  kind: "learning",
  group: "studio",
  order: 1.2,
  enabled: false,
  badge: "new",
  usesWhiteboard: true,
  metaTitle: "Voice tutor | SeeThrough",
  metaDescription:
    "SeeThrough Voice Tutor: orb-first, voice-operated lessons with Socratic checks and on-demand diagrams.",
};
