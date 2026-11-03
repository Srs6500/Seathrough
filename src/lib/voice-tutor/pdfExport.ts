import { jsPDF } from "jspdf";
import { toCanvas } from "html-to-image";
import type { LessonSourceRef, VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";

/*
 * Lesson PDF = what the student sees on the stage (whiteboard, or the written
 * passage with its diagrams and pictures), not the chat transcript.
 *
 * The stage element is marked `data-pdf-stage`; scroll containers inside it
 * are marked `data-pdf-expand` so the capture gets the full lesson, not just
 * the visible part. Elements marked `data-pdf-skip` (pen cursor, loaders,
 * video player) are left out.
 */

const PAGE_MARGIN = 28; // pt
const MAX_CANVAS_PX = 15000; // stay under browser canvas limits
const TRANSPARENT_PX =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function fileNameFor(label: string) {
  return `seethrough-${(label || "lesson")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "lesson"}.pdf`;
}

/** Temporarily un-clip scroll containers so the full lesson lays out. */
function expandForCapture(stage: HTMLElement): () => void {
  const els = [stage, ...Array.from(stage.querySelectorAll<HTMLElement>("[data-pdf-expand]"))];
  const saved = els.map((el) => ({ el, css: el.style.cssText, top: el.scrollTop }));
  for (const el of els) {
    el.style.overflow = "visible";
    el.style.height = "auto";
    el.style.maxHeight = "none";
    el.style.minHeight = "0";
    el.style.flex = "none";
    el.style.paddingBottom = "24px";
  }
  return () => {
    for (const { el, css, top } of saved) {
      el.style.cssText = css;
      el.scrollTop = top;
    }
  };
}

/** Vertical spans (CSS px from the stage top) that a page break must not cut. */
function blockSpans(stage: HTMLElement): Array<[number, number]> {
  const top = stage.getBoundingClientRect().top;
  const els = stage.querySelectorAll<HTMLElement>("[data-wb-id], [data-pdf-block]");
  const spans: Array<[number, number]> = [];
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height > 0) spans.push([r.top - top, r.bottom - top]);
  });
  return spans;
}

/** Latest break at or above `limit` that falls between blocks (never above `floor`). */
function safeBreak(limit: number, floor: number, spans: Array<[number, number]>): number {
  let cut = limit;
  for (let guard = 0; guard < 200; guard += 1) {
    const hit = spans.find(([a, b]) => a < cut - 1 && b > cut + 1);
    if (!hit) return cut;
    cut = Math.floor(hit[0]) - 6; // just above the block it would split
    if (cut <= floor) return limit; // one block taller than a page: cut it
  }
  return limit;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function header(doc: jsPDF, title: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(22, 22, 26);
  doc.text(title, PAGE_MARGIN, PAGE_MARGIN + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(113, 113, 122);
  doc.text(
    `SeeThrough · ${new Date().toLocaleDateString(undefined, { dateStyle: "medium" })}`,
    PAGE_MARGIN,
    PAGE_MARGIN + 26,
  );
  return PAGE_MARGIN + 40;
}

function sourcesPage(doc: jsPDF, sources: LessonSourceRef[] | undefined) {
  if (!sources?.length) return;
  doc.addPage();
  const width = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(22, 22, 26);
  doc.text("Sources", PAGE_MARGIN, y);
  y += 20;
  for (const src of sources) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(22, 22, 26);
    for (const row of doc.splitTextToSize(`${src.title} — ${src.publisher}`, width) as string[]) {
      doc.text(row, PAGE_MARGIN, y);
      y += 13;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(27, 108, 168);
    for (const row of doc.splitTextToSize(src.url, width) as string[]) {
      doc.text(row, PAGE_MARGIN, y);
      y += 12;
    }
    y += 8;
    if (y > doc.internal.pageSize.getHeight() - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN + 12;
    }
  }
}

/** Capture the stage as the student sees it and paginate it onto letter pages. */
export async function exportStagePdf(input: {
  stage: HTMLElement;
  title: string;
  label: string;
  sources?: LessonSourceRef[];
}): Promise<void> {
  const restore = expandForCapture(input.stage);
  let canvas: HTMLCanvasElement;
  let spans: Array<[number, number]> = [];
  let pixelRatio = 2;
  try {
    await nextFrame();
    await nextFrame();
    const fullH = input.stage.scrollHeight;
    pixelRatio = Math.max(1, Math.min(2, MAX_CANVAS_PX / Math.max(1, fullH)));
    spans = blockSpans(input.stage).map(([a, b]) => [a * pixelRatio, b * pixelRatio]);
    canvas = await toCanvas(input.stage, {
      pixelRatio,
      backgroundColor: "#ffffff",
      cacheBust: false,
      imagePlaceholder: TRANSPARENT_PX,
      filter: (node) =>
        !(
          node instanceof HTMLElement &&
          (node.hasAttribute("data-pdf-skip") || node.hasAttribute("data-orb-target"))
        ),
    });
  } finally {
    restore();
  }

  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const imgW = pageW - PAGE_MARGIN * 2;
  const ptPerPx = imgW / canvas.width;

  let top = header(doc, input.title);
  let srcY = 0;
  const slice = document.createElement("canvas");
  const ctx = slice.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  while (srcY < canvas.height) {
    const availPt = pageH - top - PAGE_MARGIN;
    const room = Math.floor(availPt / ptPerPx);
    const slicePx =
      canvas.height - srcY <= room
        ? canvas.height - srcY
        : Math.max(1, safeBreak(srcY + room, srcY + room * 0.4, spans) - srcY);
    slice.width = canvas.width;
    slice.height = slicePx;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, srcY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
    doc.addImage(slice.toDataURL("image/jpeg", 0.9), "JPEG", PAGE_MARGIN, top, imgW, slicePx * ptPerPx);
    srcY += slicePx;
    if (srcY < canvas.height) {
      doc.addPage();
      top = PAGE_MARGIN;
    }
  }

  sourcesPage(doc, input.sources);
  doc.save(fileNameFor(input.label));
}

/**
 * Fallback when the stage can't be captured: the lesson content itself
 * (sections, explanations, key points) as text — still not the chat.
 */
export function exportLessonTextPdf(input: { title: string; label: string; plan: VoiceLessonPlan }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  let y = header(doc, input.title) + 8;
  const write = (text: string, size: number, bold = false, color: [number, number, number] = [22, 22, 26]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    for (const row of doc.splitTextToSize(text, width) as string[]) {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(row, margin, y);
      y += size + 5;
    }
  };
  for (const beat of input.plan.beats) {
    if (beat.expectAnswer) continue;
    const b = beat.board;
    if (b?.sectionLabel) {
      y += 6;
      write(b.sectionLabel, 13, true, [36, 86, 199]);
    }
    write(b?.plainExplain || b?.sourceText || beat.say, 11);
    for (const point of b?.keyPoints ?? []) write(`• ${point}`, 11);
    if (b?.rememberTip) write(`Remember: ${b.rememberTip}`, 10, true, [160, 110, 20]);
    y += 6;
  }
  sourcesPage(doc, input.plan.sources);
  doc.save(fileNameFor(input.label));
}
