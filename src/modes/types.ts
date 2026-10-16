/**
 * Product mode contract — each feature plugs in by exporting a ModeDefinition.
 * Disable a mode (`enabled: false`) to hide it from home + nav without deleting code.
 */

export type ModeId =
  | "lessons"
  | "smart-tutor"
  | "physics-tutor"
  | "browser-experience"
  | "dashboard"
  | "ai-tutor"
  | "ai-tutor-v2"
  | "developer"
  | "screenshot-explain"
  | "leetcode"
  | "figures-3d"
  | "scene-explain"
  | "system-design"
  | "browser-experience"
  | "data-flow"
  | "bug-analyzer"
  | "automatic-drawing"
  | "draw-engine"
  | "explain-video";

export type ModeKind = "learning" | "tool";

/** How the product surfaces this mode in nav and home. */
export type ModeGroup = "studio" | "more" | "lab";

export type ModeDefinition = {
  /** Stable id — used in registry lookups and analytics. */
  id: ModeId;
  /** URL path for this mode’s workspace. */
  href: string;
  /** Short label for nav chips. */
  navLabel: string;
  /** Full title on home + page metadata. */
  title: string;
  /** One-line home description. */
  description: string;
  /** learning = primary product; tool = lower-priority / demo. */
  kind: ModeKind;
  /** studio = flagship; more = extra study tools; lab = experiments. */
  group: ModeGroup;
  /** Sort order on home (lower first). */
  order: number;
  /** Plug-out switch: false hides from home and ModeNav. */
  enabled: boolean;
  /** Soft badge on home. */
  badge?: "new" | "beta" | "lab";
  /** Whether this mode drives the shared whiteboard + narration stack. */
  usesWhiteboard: boolean;
  /** Page <title> suffix is handled by callers. */
  metaTitle: string;
  metaDescription: string;
};
