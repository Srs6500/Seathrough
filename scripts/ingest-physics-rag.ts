/**
 * Optional PDF → chunk ingest for physics RAG.
 * Phase 1 ships seed chunks; run this later when you want Schnick/Crowell text in-index.
 *
 * Usage:
 *   npx --yes esbuild scripts/ingest-physics-rag.ts --bundle --platform=node --outfile=/tmp/ingest-physics.js
 *   node /tmp/ingest-physics.js
 *
 * Requires `pdftotext` (poppler) OR a future pdf parser. Without a PDF tool, exits 0 and keeps seed-only RAG.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const DATA = join(ROOT, "Physics-tutor-data");
const OUT_DIR = join(DATA, "chunks");
const OUT = join(OUT_DIR, "ingested.json");

const SOURCES: Array<{ file: string; source: "schnick" | "crowell" }> = [
  { file: "cbPhysicsIIb24.pdf", source: "schnick" },
  { file: "CrowellBenjamin-SimpleNature(OER).pdf", source: "crowell" },
];

const KEEP =
  /electric|charge|coulomb|field|potential|capacitor|conductor|dipole|gauss|equipotential|electrostat/i;

function hasPdftotext() {
  const r = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
  // pdftotext prints version to stderr and may exit non-zero
  return r.status === 0 || /pdftotext/i.test(`${r.stdout}\n${r.stderr}`);
}

function extractPdf(path: string): string {
  const r = spawnSync("pdftotext", ["-layout", path, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    throw new Error(r.stderr || r.error?.message || "pdftotext failed");
  }
  return r.stdout || "";
}

function chunkText(text: string, source: "schnick" | "crowell"): Array<{
  id: string;
  source: "schnick" | "crowell";
  title: string;
  topic: string;
  text: string;
}> {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 120 && KEEP.test(p));

  const chunks: Array<{
    id: string;
    source: "schnick" | "crowell";
    title: string;
    topic: string;
    text: string;
  }> = [];

  let buf = "";
  let n = 0;
  const flush = () => {
    const body = buf.trim();
    if (body.length < 160) {
      buf = "";
      return;
    }
    n += 1;
    const topic =
      (/capacitor/i.test(body) && "capacitor") ||
      (/dipole/i.test(body) && "dipole") ||
      (/potential/i.test(body) && "potential") ||
      (/conductor/i.test(body) && "conductor") ||
      (/coulomb/i.test(body) && "coulomb") ||
      "electric field";
    chunks.push({
      id: `${source}-${n}`,
      source,
      title: `${source} extract ${n}`,
      topic,
      text: body.slice(0, 1200),
    });
    buf = "";
  };

  for (const para of paras) {
    if ((buf + " " + para).length > 900) flush();
    buf = buf ? `${buf} ${para}` : para;
  }
  flush();
  return chunks;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  if (!hasPdftotext()) {
    console.log(
      "ingest:physics — pdftotext not found. Seed RAG stays active; install poppler later to extract PDFs.",
    );
    if (!existsSync(OUT)) {
      writeFileSync(OUT, "[]\n", "utf8");
    }
    process.exit(0);
  }

  const all = [];
  for (const src of SOURCES) {
    const path = join(DATA, src.file);
    if (!existsSync(path)) {
      console.log(`skip missing ${src.file}`);
      continue;
    }
    console.log(`extracting ${src.file}…`);
    const text = extractPdf(path);
    const parts = chunkText(text, src.source);
    console.log(`  → ${parts.length} electrostatics-ish chunks`);
    all.push(...parts);
  }

  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  console.log(`wrote ${all.length} chunks → ${OUT}`);
}

main();
