import type { ModeDefinition } from "@/modes/types";

/** Deterministic algorithm step visualizer for LeetCode-style prompts. */
export const leetcodeMode: ModeDefinition = {
  id: "leetcode",
  href: "/leetcode",
  navLabel: "Coding",
  title: "Coding practice",
  description: "Paste a LeetCode-style problem and step through how it works.",
  kind: "learning",
  group: "more",
  order: 50,
  enabled: false,
  usesWhiteboard: false,
  metaTitle: "Coding practice",
  metaDescription:
    "Step through arrays, pointers, and hash maps for coding interview practice.",
};
