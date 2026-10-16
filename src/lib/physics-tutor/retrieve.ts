import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import seedChunks from "@/lib/physics-tutor/chunks/electrostatics.seed.json";
import bundledIngested from "@/lib/physics-tutor/chunks/ingested.json";
import type { PhysicsChunk, PhysicsRetrievalHit } from "@/lib/physics-tutor/types";

/** Local re-ingest output (dev only). Production uses the bundled copy below. */
const LOCAL_INGESTED_PATH = join(
  process.cwd(),
  "Physics-tutor-data",
  "chunks",
  "ingested.json",
);

/** Words that inflate scores on every ask without meaning the chunk is relevant. */
const STOP = new Set([
  "the",
  "and",
  "can",
  "you",
  "what",
  "how",
  "does",
  "do",
  "did",
  "explain",
  "describe",
  "tell",
  "about",
  "laws",
  "law",
  "work",
  "works",
  "called",
  "symbol",
  "name",
  "please",
  "with",
  "from",
  "this",
  "that",
  "into",
  "onto",
  "for",
  "are",
  "is",
  "was",
  "were",
  "of",
  "to",
  "in",
  "on",
  "at",
  "an",
  "a",
  "or",
  "as",
  "be",
  "by",
  "it",
  "its",
  "we",
  "they",
  "them",
  "their",
  "square",
  "squared",
]);

function asChunks(value: unknown): PhysicsChunk[] {
  if (!Array.isArray(value)) return [];
  const out: PhysicsChunk[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.text !== "string") continue;
    if (!r.text.trim()) continue;
    out.push({
      id: r.id,
      source:
        r.source === "schnick" ||
        r.source === "crowell" ||
        r.source === "vfpt" ||
        r.source === "seed"
          ? r.source
          : "seed",
      title: typeof r.title === "string" ? r.title : r.id,
      topic: typeof r.topic === "string" ? r.topic : "physics",
      text: r.text.trim(),
      ...(typeof r.diagram === "string" ? { diagram: r.diagram } : {}),
    });
  }
  return out;
}

function loadIngested(): PhysicsChunk[] {
  // Prefer a fresher local ingest when present (npm run ingest:physics).
  if (existsSync(LOCAL_INGESTED_PATH)) {
    try {
      const local = asChunks(JSON.parse(readFileSync(LOCAL_INGESTED_PATH, "utf8")));
      if (local.length > 0) return local;
    } catch {
      /* fall through to bundled */
    }
  }
  return asChunks(bundledIngested);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+\-./\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function sourceBias(source: PhysicsChunk["source"]): number {
  if (source === "seed") return 2.5;
  if (source === "crowell") return 1.5;
  if (source === "vfpt") return 1;
  return 0;
}

function topicBoost(q: string, chunk: PhysicsChunk): number {
  const hay = `${chunk.topic} ${chunk.title} ${chunk.text}`;
  let boost = 0;
  if (q.includes(chunk.topic.toLowerCase())) boost += 3;
  if (/dipole/.test(q) && /dipole/i.test(hay)) boost += 6;
  if (/capacitor/.test(q) && /capacitor/i.test(hay)) boost += 6;
  if (/potential|voltage|equipotential/.test(q) && /potential|voltage|equipotential/i.test(hay))
    boost += 5;
  if (/coulomb|force between charges/.test(q) && /coulomb/i.test(hay)) boost += 6;
  if (/conductor|metal ball|faraday/.test(q) && /conductor|metal|faraday/i.test(hay))
    boost += 5;
  if (/field line|electric field|e-?field/.test(q) && /electric field|field line/i.test(hay))
    boost += 5;
  if (/charge|monopole|point charge/.test(q) && /charge|monopole/i.test(hay)) boost += 3;
  if (/gauss/.test(q) && /gauss/i.test(hay)) boost += 5;
  if (/solenoid|helmholtz|magnetic field|biot|ampere/.test(q) && /magnetic|solenoid|coil|biot|ampere/i.test(hay))
    boost += 5;
  if (/resistan|ohm|circuit|current|kirchhoff/.test(q) && /resistan|ohm|circuit|current/i.test(hay))
    boost += 5;
  if (/kepler|orbit|planet/.test(q) && /kepler|keplerian|gravitat(?:ion|ional)|planetary orbit/i.test(hay))
    boost += 6;
  // Mechanics: chunk must be about Newton/inertia — not a side mention inside Coulomb's law
  if (/\bnewton/.test(q)) {
    const emTopic = /electric|coulomb|capacitor|dipole|magnet/i.test(
      `${chunk.topic} ${chunk.title}`,
    );
    if (
      !emTopic &&
      (/\bnewton(?:'s)?\s+laws?\b|\binertia\b|f\s*=\s*ma|first law|second law|third law/i.test(
        hay,
      ) ||
        /\bnewton\b/i.test(hay))
    ) {
      boost += 5;
    }
  }
  return boost;
}

/**
 * Simple lexical RAG — no embeddings / LangChain.
 * Returns [] when nothing is actually on-topic (better than wrong coils/chunks).
 */
export function retrievePhysicsChunks(
  prompt: string,
  limit = 5,
): PhysicsRetrievalHit[] {
  const query = prompt.trim();
  if (!query) return [];

  const corpus = [...asChunks(seedChunks), ...loadIngested()];
  if (corpus.length === 0) return [];

  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const qTokenSet = new Set(qTokens);
  const q = query.toLowerCase();
  const scored: PhysicsRetrievalHit[] = [];

  for (const chunk of corpus) {
    const hay = tokenize(`${chunk.title} ${chunk.topic} ${chunk.text}`);
    let overlap = 0;
    for (const token of hay) {
      if (qTokenSet.has(token)) overlap += 1;
    }
    // Unique query-token coverage (not raw count in long PDF chunks)
    const covered = qTokens.filter((t) => hay.includes(t)).length;
    const boost = topicBoost(q, chunk);
    const score =
      covered * 3 + Math.min(overlap, 8) * 0.25 + boost + sourceBias(chunk.source);

    // Require a real topic boost — raw token overlap on long PDFs is too noisy
    // (it was returning Helmholtz + random E&M for Kepler/Newton asks).
    if (boost < 4) continue;
    if (score < 10) continue;

    scored.push({
      ...chunk,
      text: chunk.text.slice(0, 700),
      score: Math.round(score * 10) / 10,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const picked: PhysicsRetrievalHit[] = [];
  const perSource = new Map<string, number>();
  for (const hit of scored) {
    const n = perSource.get(hit.source) ?? 0;
    if (n >= 3) continue;
    perSource.set(hit.source, n + 1);
    picked.push(hit);
    if (picked.length >= Math.max(1, limit)) break;
  }
  return picked;
}

export function physicsCorpusStats(): {
  seed: number;
  ingested: number;
  total: number;
} {
  const seed = asChunks(seedChunks).length;
  const ingested = loadIngested().length;
  return { seed, ingested, total: seed + ingested };
}
