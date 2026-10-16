import type { LucideIcon } from "lucide-react";
import {
  Atom,
  BookOpen,
  Box,
  Camera,
  Code2,
  Compass,
  HeartPulse,
  LayoutDashboard,
  Lightbulb,
  Monitor,
  Bug,
  GitBranch,
  Network,
  PenLine,
  Sparkles,
  Film,
  WandSparkles,
} from "lucide-react";
import type { ModeId } from "@/modes/types";

export type ModeUi = {
  icon: LucideIcon;
  /** One line a tired student can parse in a second. */
  hint: string;
  /** Studio accent: blue topic, copper systems, teal scenes. */
  tone: "blue" | "copper" | "teal" | "ink";
};

export const MODE_UI: Record<ModeId, ModeUi> = {
  "smart-tutor": {
    icon: Sparkles,
    hint: "Ask a question. The tutor draws, talks, and checks you understood.",
    tone: "blue",
  },
  "physics-tutor": {
    icon: Atom,
    hint: "Ask physics. Field diagrams, short steps, then a check you understood.",
    tone: "teal",
  },
  "browser-experience": {
    icon: Compass,
    hint: "Ask a question. We open a live browser, find a credible page, and highlight while explaining.",
    tone: "teal",
  },
  dashboard: {
    icon: LayoutDashboard,
    hint: "Watch lessons you saved as videos, and rename the titles.",
    tone: "blue",
  },
  lessons: {
    icon: BookOpen,
    hint: "Type what you’re stuck on. We’ll draw it step by step.",
    tone: "blue",
  },
  "ai-tutor": {
    icon: Lightbulb,
    hint: "Answer in your own words. A picture appears when a mix-up shows up.",
    tone: "blue",
  },
  "ai-tutor-v2": {
    icon: Sparkles,
    hint: "Ask a question. Watch a streamed whiteboard lesson with follow-ups.",
    tone: "blue",
  },
  developer: {
    icon: Monitor,
    hint: "Two agents take work from a project manager and code at their desks.",
    tone: "ink",
  },
  "system-design": {
    icon: Network,
    hint: "Watch a full design stay on the board, diagram under diagram.",
    tone: "copper",
  },
  developer: {
    icon: Monitor,
    hint: "Two agents take work from a project manager and code at their desks.",
    tone: "ink",
  },
  "scene-explain": {
    icon: Atom,
    hint: "Ask for osmosis, orbits, anything — a 3D scene builds and explains it.",
    tone: "teal",
  },
  "screenshot-explain": {
    icon: Camera,
    hint: "Upload homework or notes. We read it and draw the explanation.",
    tone: "blue",
  },
  leetcode: {
    icon: Code2,
    hint: "Paste a coding problem. Watch the steps on the board.",
    tone: "ink",
  },
  "figures-3d": {
    icon: HeartPulse,
    hint: "Explore the heart, eye, brain, and kidney in 3D.",
    tone: "teal",
  },
  "automatic-drawing": {
    icon: PenLine,
    hint: "Type a drawing. Watch the board make it.",
    tone: "ink",
  },
  "draw-engine": {
    icon: WandSparkles,
    hint: "Timed board commands — for trying the draw engine.",
    tone: "ink",
  },
  "explain-video": {
    icon: Film,
    hint: "Type a topic. Watch a short explainer film.",
    tone: "ink",
  },
};

export const MORE_ICON = Box;

export const TONE_CLASS: Record<ModeUi["tone"], string> = {
  blue: "bg-accent-soft text-accent-deep",
  copper: "bg-copper-soft text-copper-deep",
  teal: "bg-success-soft text-success",
  ink: "bg-secondary text-ink-soft",
};
