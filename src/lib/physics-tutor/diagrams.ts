import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export type VfptDiagram = {
  filename: string;
  label: string;
  topics: string[];
};

/** Search these folders for diagrams (user drops files in any of them). */
const DIAGRAM_DIRS = [
  join(process.cwd(), "public", "physics", "vfpt"),
  join(process.cwd(), "Physics-tutor-data", "vfpt-svgs"),
  join(process.cwd(), "Physics-tutor-data"),
];

const TOPIC_HINTS: Array<{ re: RegExp; topic: string }> = [
  { re: /plus|minus|charge/i, topic: "charge" },
  { re: /dipole/i, topic: "dipole" },
  { re: /capacitor|battery/i, topic: "capacitor" },
  { re: /potential|contour/i, topic: "potential" },
  { re: /metal|ball|conductor/i, topic: "conductor" },
  { re: /sheet|rod|wire/i, topic: "continuous charge" },
  { re: /solenoid|coil|helmholtz|magnetic|ring/i, topic: "magnetism" },
  { re: /circuit|resistor|ohm/i, topic: "circuit" },
  { re: /image.?charge/i, topic: "image charge" },
];

/** Query synonyms → tokens that appear in filenames/topics. */
const QUERY_SYNONYMS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /resistan|ohm|circuit|resistor|battery|kirchhoff/i, tokens: ["circuit", "resistor", "capacitor", "battery"] },
  { re: /capacitor|parallel.?plate|dielectric/i, tokens: ["capacitor", "plate", "battery"] },
  { re: /dipole/i, tokens: ["dipole"] },
  { re: /monopole|point charge|single charge/i, tokens: ["plus", "minus", "charge"] },
  { re: /opposite charge|plus.?minus|attract/i, tokens: ["plus", "minus", "charge", "dipole"] },
  { re: /like charge|repel|plus.?plus|minus.?minus/i, tokens: ["plus", "minus", "charge"] },
  { re: /conductor|metal ball|induced/i, tokens: ["metal", "ball", "conductor"] },
  { re: /image charge|grounded plane/i, tokens: ["image", "charge", "plane"] },
  { re: /solenoid/i, tokens: ["solenoid"] },
  { re: /helmholtz/i, tokens: ["helmholtz", "coil"] },
  { re: /wire|current|biot|ampere/i, tokens: ["wire", "current", "ring"] },
  { re: /magnetic|magnet/i, tokens: ["magnetic", "dipole", "solenoid", "coil", "wire"] },
  { re: /electric field|e-?field|field line/i, tokens: ["charge", "dipole", "plus", "minus", "field"] },
  { re: /potential|voltage|equipotential/i, tokens: ["potential", "contour"] },
  { re: /kepler|orbit|newton|force|gravitat/i, tokens: ["charge", "dipole", "plus", "minus"] },
];

const STOP = new Set([
  "the", "and", "can", "you", "what", "how", "does", "explain", "describe",
  "about", "with", "from", "this", "that", "for", "are", "is", "of", "to",
  "in", "on", "a", "an", "or", "vfpt", "svg", "thumb", "correct", "correct2",
]);

function labelFromFilename(filename: string): string {
  return filename
    .replace(/\.(svg|png|jpe?g|webp)$/i, "")
    .replace(/^VFPt\s+/i, "")
    .replace(/[_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topicsFor(filename: string): string[] {
  const topics = new Set<string>();
  for (const hint of TOPIC_HINTS) {
    if (hint.re.test(filename)) topics.add(hint.topic);
  }
  if (topics.size === 0) topics.add("electric field");
  return [...topics];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function collectFiles(dir: string, out: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Don't walk unrelated Physics-tutor-data subfolders except vfpt-svgs tree
      if (dir.endsWith("Physics-tutor-data") && entry !== "vfpt-svgs") continue;
      collectFiles(full, out);
      continue;
    }
    if (!/\.(svg|png)$/i.test(entry) || st.size < 100) continue;
    out.push(full);
  }
}

/** Unique diagrams on disk (dedupes gallery-dl hash copies). */
export function listVfptDiagrams(): VfptDiagram[] {
  const paths: string[] = [];
  for (const dir of DIAGRAM_DIRS) collectFiles(dir, paths);

  const byKey = new Map<string, VfptDiagram & { bytes: number }>();
  for (const path of paths) {
    let name = basename(path);
    name = name.replace(/ \([0-9a-f]{8}\)\.(svg|png)$/i, ".$1");
    const key = name.toLowerCase().replace(/_/g, " ");
    const displayName = name.replace(/_/g, " ");
    let bytes = 0;
    try {
      bytes = statSync(path).size;
    } catch {
      continue;
    }
    const prev = byKey.get(key);
    if (prev && prev.bytes >= bytes && !/thumb/i.test(prev.filename)) continue;
    if (prev && /thumb/i.test(displayName) && !/thumb/i.test(prev.filename)) continue;
    byKey.set(key, {
      filename: displayName,
      label: labelFromFilename(displayName),
      topics: topicsFor(displayName),
      bytes,
    });
  }
  return [...byKey.values()]
    .map(({ filename, label, topics }) => ({ filename, label, topics }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function queryTokens(prompt: string): string[] {
  const base = tokenize(prompt);
  const extra: string[] = [];
  for (const syn of QUERY_SYNONYMS) {
    if (syn.re.test(prompt)) extra.push(...syn.tokens);
  }
  return [...new Set([...base, ...extra])];
}

/** Higher = closer match. Always comparable so fallback is still “closest”. */
export function scoreDiagram(prompt: string, d: VfptDiagram): number {
  const q = prompt.toLowerCase();
  const qTokens = queryTokens(prompt);
  const fileTokens = new Set([
    ...tokenize(d.filename),
    ...tokenize(d.label),
    ...d.topics.flatMap((t) => tokenize(t)),
  ]);

  let score = 0;

  // Token overlap (closest-match core)
  let hit = 0;
  for (const t of qTokens) {
    if (fileTokens.has(t)) {
      hit += 1;
      score += 2.5;
    } else {
      // partial: "charges" vs "charge"
      for (const ft of fileTokens) {
        if (ft.startsWith(t) || t.startsWith(ft)) {
          score += 1;
          hit += 0.5;
          break;
        }
      }
    }
  }
  if (qTokens.length > 0) {
    score += (hit / qTokens.length) * 4;
  }

  for (const topic of d.topics) {
    if (topic.length > 3 && q.includes(topic)) score += 3;
  }

  // Hard topic boosts
  if (/dipole/.test(q) && /dipole/i.test(d.filename)) score += 8;
  if (/capacitor|parallel.?plate|battery/.test(q) && /capacitor|battery|plate/i.test(d.filename))
    score += 8;
  if (/circuit|resistor|ohm|resistance/.test(q) && /circuit|resistor/i.test(d.filename))
    score += 8;
  if (/potential|equipotential/.test(q) && /potential|contour/i.test(d.filename)) score += 5;
  if (/(charge|plus|minus|monopole)/.test(q) && /charge|plus|minus/i.test(d.filename))
    score += 5;
  if (/conductor|metal ball/.test(q) && /metal|ball/i.test(d.filename)) score += 6;
  if (/image.?charge/.test(q) && /image/i.test(d.filename)) score += 8;
  if (/solenoid/.test(q) && /solenoid/i.test(d.filename)) score += 8;
  if (/helmholtz/.test(q) && /helmholtz/i.test(d.filename)) score += 8;
  if (/wire|current/.test(q) && /wire|current|ring/i.test(d.filename)) score += 5;
  if (/magnetic|magnet/.test(q) && /magnetic|solenoid|coil|wire|ring|helmholtz/i.test(d.filename))
    score += 4;
  if (/electric field|field line/.test(q) && /charge|dipole|plus|minus|field/i.test(d.filename))
    score += 3;

  // Soft library bias for true ties
  if (/charge|dipole|plus|minus|metal|capacitor|potential|circuit|resistor/i.test(d.filename))
    score += 0.25;
  if (/coil|helmholtz|solenoid|maxwell|ring/i.test(d.filename)) score -= 0.05;
  if (/thumb/i.test(d.filename)) score -= 3;

  return score;
}

/**
 * Always returns the closest diagram(s) from the local set.
 * Fallback = highest score even when weak — never random alphabetical.
 */
export function pickDiagramsForPrompt(
  prompt: string,
  limit = 4,
): VfptDiagram[] {
  const all = listVfptDiagrams();
  if (all.length === 0) return [];

  const scored = all
    .map((d) => ({ d, score: scoreDiagram(prompt, d) }))
    .sort((a, b) => b.score - a.score || a.d.filename.localeCompare(b.d.filename));

  const strong = scored.filter((row) => row.score >= 4);
  if (strong.length > 0) {
    return strong.slice(0, limit).map((r) => r.d);
  }
  // Closest fallback (top 1–2 by score)
  return scored.slice(0, Math.min(limit, 2)).map((r) => r.d);
}
