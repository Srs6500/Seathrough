import path from "node:path";
import { createRequire } from "node:module";
import type {
  ImageExtractAdapter,
  ImageExtractInput,
} from "@/lib/image-explain/extract/types";
import type { ImageExtraction } from "@/lib/image-explain/types";

// Resolve from this module so webpack/Turbopack can parse createRequire statically.
const requireFromHere = createRequire(import.meta.url);

function tesseractNodeOptions() {
  const pkgRoot = path.dirname(requireFromHere.resolve("tesseract.js/package.json"));
  const coreRoot = path.dirname(
    requireFromHere.resolve("tesseract.js-core/package.json"),
  );
  const root = /* turbopackIgnore: true */ process.cwd();
  return {
    // Absolute disk paths — Turbopack's /ROOT remap breaks default resolution.
    workerPath: path.join(pkgRoot, "src/worker-script/node/index.js"),
    corePath: coreRoot,
    // Node workers should not use blob URLs.
    workerBlobURL: false as const,
    cachePath: path.join(root, ".cache/tesseract"),
    errorHandler: (err: unknown) => {
      console.error("[tesseract-ocr]", err);
    },
  };
}

/**
 * Classic OCR fallback via tesseract.js (no vision model required).
 * Loaded dynamically so Next bundles stay lean when unused.
 */
export const ocrExtractAdapter: ImageExtractAdapter = {
  id: "ocr",
  label: "Tesseract OCR",
  async extract(input: ImageExtractInput): Promise<ImageExtraction> {
    const { createWorker } = requireFromHere("tesseract.js") as typeof import("tesseract.js");
    const worker = await createWorker("eng", 1, tesseractNodeOptions());
    try {
      const result = await worker.recognize(input.bytes);
      const text = (result.data.text ?? "").trim();
      if (!text) {
        return {
          engine: "ocr",
          kind: "other",
          title: "No text found",
          text: "OCR could not read any text in this image.",
          blocks: [],
          confidence: 0,
        };
      }

      const blocks = text
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 40)
        .map((part) => ({ text: part }));

      const confidence =
        typeof result.data.confidence === "number"
          ? Math.max(0, Math.min(1, result.data.confidence / 100))
          : undefined;

      return {
        engine: "ocr",
        kind: guessKind(text),
        title: truncate(text.split("\n").find(Boolean) ?? "OCR extract", 80),
        text,
        blocks,
        confidence,
      };
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  },
};

function guessKind(
  text: string,
): ImageExtraction["kind"] {
  const t = text.toLowerCase();
  if (/```|function\s+\w+|const\s+\w+\s*=|def\s+\w+/.test(t)) return "code";
  if (/\b(find|solve|prove|calculate|what is)\b|\?\s*$/m.test(t)) {
    return "problem";
  }
  if (/\|.+\|/.test(t) && /\n/.test(t)) return "table";
  return "notes";
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
