/**
 * Dynamic math → speech via Temml (TeX→MathML) + Speech Rule Engine (ClearSpeak).
 * Captions stay as written; only the TTS path should call this.
 *
 * Not a hand-maintained symbol dictionary — SRE owns how integrals, fractions,
 * Greek letters, etc. are spoken.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { mathToSpeech } from "@/lib/math/mathToSpeech";

type SreApi = {
  setupEngine: (options: Record<string, unknown>) => Promise<void>;
  engineReady: () => Promise<void>;
  toSpeech: (mathml: string) => string;
};

type TemmlApi = {
  renderToString: (
    tex: string,
    options?: Record<string, unknown>,
  ) => string;
};

// cwd-based so this works in Next and in esbuild-bundled smokes (no import.meta.url).
const require = createRequire(join(process.cwd(), "package.json"));

let srePromise: Promise<SreApi> | null = null;
let temml: TemmlApi | null = null;

function getTemml(): TemmlApi {
  if (!temml) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    temml = require("temml") as TemmlApi;
  }
  return temml;
}

async function getSre(): Promise<SreApi> {
  if (!srePromise) {
    srePromise = (async () => {
      process.env.SRE_JSON_PATH =
        process.env.SRE_JSON_PATH ||
        join(
          process.cwd(),
          "node_modules",
          "speech-rule-engine",
          "lib",
          "mathmaps",
        );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sre = require("speech-rule-engine") as SreApi;
      await sre.setupEngine({
        domain: "clearspeak",
        locale: "en",
        modality: "speech",
        speech: "deep",
        markup: "none",
      });
      await sre.engineReady();
      return sre;
    })();
  }
  return srePromise;
}

function extractMathElement(html: string): string | null {
  const match = html.match(/<math\b[\s\S]*?<\/math>/i);
  return match?.[0] ?? null;
}

/** Turn a TeX / ascii-math snippet into spoken English via SRE. */
export async function texToSpoken(tex: string): Promise<string | null> {
  const trimmed = tex.trim();
  if (!trimmed) return null;
  try {
    const html = getTemml().renderToString(trimmed, {
      throwOnError: false,
      displayMode: false,
      annotate: false,
    });
    const mathml = extractMathElement(String(html));
    if (!mathml) return null;
    const sre = await getSre();
    const spoken = sre.toSpeech(mathml).replace(/\s+/g, " ").trim();
    return spoken || null;
  } catch {
    return null;
  }
}

/**
 * Normalize a few ascii calculus spellings into TeX so Temml/SRE can parse them.
 * This is input shaping, not a spoken vocabulary list.
 */
function toTexCandidate(raw: string): string {
  let s = raw.trim();
  // Already TeX-ish
  if (s.includes("\\") || s.includes("^") || s.includes("_") || /[{}]/.test(s)) {
    return s;
  }
  // d/dx, dy/dx, d^2y/dx^2
  s = s.replace(
    /^d\^?(\d*)([a-zA-Z]?)\s*\/\s*d([a-zA-Z])\^?(\d*)$/,
    (_, order: string, num: string, den: string, denOrder: string) => {
      const o = order || denOrder;
      if (o && o !== "1") {
        return num
          ? `\\frac{d^{${o}}${num}}{d${den}^{${o}}}`
          : `\\frac{d^{${o}}}{d${den}^{${o}}}`;
      }
      return num ? `\\frac{d${num}}{d${den}}` : `\\frac{d}{d${den}}`;
    },
  );
  // ∂f/∂x
  s = s.replace(
    /^∂\s*([a-zA-Z]?)\s*\/\s*∂\s*([a-zA-Z])$/,
    (_, num: string, den: string) =>
      num ? `\\frac{\\partial ${num}}{\\partial ${den}}` : `\\frac{\\partial}{\\partial ${den}}`,
  );
  return s;
}

type Piece = { kind: "text" | "math"; value: string };

/**
 * Split a tutor line into prose vs math islands (LaTeX delimiters + ascii/unicode math).
 */
export function splitMathIslands(input: string): Piece[] {
  const pieces: Piece[] = [];
  const pattern =
    /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\\begin\{([^}]+)\}([\s\S]*?)\\end\{\5\}|(?<![A-Za-z])((?:d\^?\d*[a-zA-Z]?\s*\/\s*d[a-zA-Z]\^?\d*|∂[^/\s]*\s*\/\s*∂[a-zA-Z]|∫[^.,;:!?]{0,80}|\\(?:frac|dfrac|tfrac|sqrt|int|iint|iiint|sum|prod|lim|partial|nabla|vec|mathbf|mathrm|left|right|over|binom)[^.,;:!?]{0,120}|[πμθε∫∂∇√∞±≤≥≠≈·×÷][^.,;!?]{0,40}))(?![A-Za-z])/g;

  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    if (match.index > last) {
      pieces.push({ kind: "text", value: input.slice(last, match.index) });
    }
    const tex =
      match[1] ??
      match[2] ??
      match[3] ??
      match[4] ??
      (match[5] && match[6] != null
        ? `\\begin{${match[5]}}${match[6]}\\end{${match[5]}}`
        : null) ??
      match[7] ??
      match[0];
    pieces.push({ kind: "math", value: tex });
    last = match.index + match[0].length;
  }
  if (last < input.length) {
    pieces.push({ kind: "text", value: input.slice(last) });
  }
  return pieces.length ? pieces : [{ kind: "text", value: input }];
}

/**
 * Deepgram-only phonetics after SRE (SRE still says "mu"/"pi").
 * Keep this tiny — not a math vocabulary.
 */
export function deepgramPhonetics(input: string): string {
  return input
    .replace(/\bmu(?:\s+sub\s+0)?\b/gi, (m) =>
      /sub\s+0/i.test(m) ? "mew naught" : "mew",
    )
    .replace(/\bpi\b/gi, "pie")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Speak a full tutor line: math islands via Temml+SRE; leftover ascii via mathToSpeech.
 */
export async function speakMathDynamically(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const pieces = splitMathIslands(trimmed);
  const out: string[] = [];

  for (const piece of pieces) {
    if (piece.kind === "text") {
      out.push(mathToSpeech(piece.value));
      continue;
    }
    const tex = toTexCandidate(piece.value);
    const spoken = await texToSpoken(tex);
    out.push(spoken ? ` ${spoken} ` : ` ${mathToSpeech(piece.value)} `);
  }

  return deepgramPhonetics(out.join("").replace(/\s+/g, " ").trim());
}
