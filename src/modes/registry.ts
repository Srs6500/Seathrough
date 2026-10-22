import { automaticDrawingMode } from "@/modules/automatic-drawing/mode";
import { browserExperienceMode } from "@/modules/browser-experience/mode";
import { explainVideoMode } from "@/modules/explain-video/mode";
import { aiTutorMode } from "@/modules/ai-tutor/mode";
import { aiTutorV2Mode } from "@/modules/ai-tutor-v2/mode";
import { bugAnalyzerMode } from "@/modules/bug-analyzer/mode";
import { dataFlowMode } from "@/modules/data-flow/mode";
import { dashboardMode } from "@/modules/dashboard/mode";
import { drawEngineMode } from "@/modules/draw-engine/mode";
import { figures3dMode } from "@/modules/figures-3d/mode";
import { leetcodeMode } from "@/modules/leetcode/mode";
import { lessonsMode } from "@/modules/lessons/mode";
import { sceneExplainMode } from "@/modules/scene-explain/mode";
import { screenshotExplainMode } from "@/modules/screenshot-explain/mode";
import { physicsTutorMode } from "@/modules/physics-tutor/mode";
import { smartTutorMode } from "@/modules/smart-tutor/mode";
import { systemDesignMode } from "@/modules/system-design/mode";
import { voiceTutorMode } from "@/modules/voice-tutor/mode";
import type { ModeDefinition, ModeGroup, ModeId, ModeKind } from "@/modes/types";

/**
 * Master catalog. To plug a mode out: set `enabled: false` on its mode.ts
 * (or remove it from ALL_MODES). Home + ModeNav read only enabled entries.
 */
const ALL_MODES: ModeDefinition[] = [
  smartTutorMode,
  voiceTutorMode,
  physicsTutorMode,
  browserExperienceMode,
  dashboardMode,
  lessonsMode,
  aiTutorMode,
  aiTutorV2Mode,
  systemDesignMode,
  dataFlowMode,
  bugAnalyzerMode,
  sceneExplainMode,
  screenshotExplainMode,
  leetcodeMode,
  figures3dMode,
  automaticDrawingMode,
  drawEngineMode,
  explainVideoMode,
];

function byOrder(a: ModeDefinition, b: ModeDefinition) {
  return a.order - b.order;
}

/** All registered modes (including disabled) — for admin/debug. */
export function listAllModes(): ModeDefinition[] {
  return [...ALL_MODES].sort(byOrder);
}

/** Modes shown on home and in ModeNav. */
export function listEnabledModes(kind?: ModeKind): ModeDefinition[] {
  return ALL_MODES.filter((m) => m.enabled && (kind ? m.kind === kind : true)).sort(
    byOrder,
  );
}

export function listModesByGroup(group: ModeGroup): ModeDefinition[] {
  return ALL_MODES.filter((m) => m.enabled && m.group === group).sort(byOrder);
}

export function getMode(id: ModeId): ModeDefinition | undefined {
  return ALL_MODES.find((m) => m.id === id);
}

export function getModeByHref(href: string): ModeDefinition | undefined {
  const normalized = href.replace(/\/$/, "") || "/";
  return ALL_MODES.find((m) => m.href === normalized);
}

/** Sibling modes for ModeNav (exclude current, only enabled). */
export function listSiblingModes(currentId?: ModeId): ModeDefinition[] {
  return listEnabledModes().filter((m) => m.id !== currentId);
}
