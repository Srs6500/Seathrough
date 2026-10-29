/**
 * Topic-gated VFPt (physics field SVG) selection for Voice Tutor.
 * Strict: only electrostatics-ish asks, and only when score clears a floor.
 * Never random / never weak alphabetical fallback.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  listVfptDiagrams,
  scoreDiagram,
  type VfptDiagram,
} from "@/lib/physics-tutor/diagrams";

/** Electric / magnetic / circuit corpus — do not open for unrelated subjects. */
const VFPT_ELECTRIC_TOPIC =
  /\b(electric(?:\s+fields?)?|electrostat\w*|point\s+charges?|(?:like|opposite)\s+charges?|\bcharges?\b|dipole|capacitor|gauss(?:['’]?s)?\s+law|coulomb|equipotential|conductor|metal\s+ball|image\s+charge|field\s+lines?|parallel\s+plates?|monopole|induced\s+charge|solenoid|magnetic(?:\s+fields?)?|magnetism|helmholtz|circuit|resistor|kirchhoff|ohm(?:'s)?\s+law|current.?carry|biot.?savart|ampere)\b/i;

/** Broader physics ask — field pictures when gated, otherwise a mechanism sketch. */
const PHYSICS_ASK =
  /\b(physics|newton(?:'?s)?|kinematics?|momentum|gravity|gravitational|projectile|friction|torque|optics|refraction|lens(?:es)?|wavelength|voltage|current|ohm|watt|joule|kinetic energy|potential energy|net force|acceleration|inertia)\b/i;

/** Minimum scoreDiagram() result before we show a figure. */
export const VFPT_VOICE_MIN_SCORE = 5;

export function looksLikeVfptElectricTopic(text: string): boolean {
  return VFPT_ELECTRIC_TOPIC.test(text.trim());
}

export function looksLikePhysicsAsk(text: string): boolean {
  const q = text.trim();
  return looksLikeVfptElectricTopic(q) || PHYSICS_ASK.test(q);
}

export function publicVfptUrl(filename: string): string {
  return `/physics/vfpt/${encodeURIComponent(filename)}`;
}

export function vfptOnDisk(filename: string): boolean {
  return existsSync(join(process.cwd(), "public", "physics", "vfpt", filename));
}

export type VfptVoicePick = {
  diagram: VfptDiagram;
  score: number;
  url: string;
};

/**
 * Pick at most one VFPt diagram for Voice Tutor, or null.
 * Returns null when topic gate fails, corpus empty, file missing, or score weak.
 */
export function pickVfptForVoiceTutor(prompt: string): VfptVoicePick | null {
  const q = prompt.trim();
  if (!q || !looksLikeVfptElectricTopic(q)) return null;

  const all = listVfptDiagrams().filter((d) => vfptOnDisk(d.filename));
  if (!all.length) return null;

  const scored = all
    .map((d) => ({ d, score: scoreDiagram(q, d) }))
    .sort((a, b) => b.score - a.score || a.d.filename.localeCompare(b.d.filename));

  const best = scored[0];
  if (!best || best.score < VFPT_VOICE_MIN_SCORE) return null;

  return {
    diagram: best.d,
    score: best.score,
    url: publicVfptUrl(best.d.filename),
  };
}
