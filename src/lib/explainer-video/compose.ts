/**
 * Script + real word timings → a HyperFrames project (file map).
 *
 * Tracks, bottom to top: paper (0), scenes (1, one sub-composition per hook /
 * point / closing, each with its own GSAP timeline), presenter (2), captions
 * (3), wipes (4), then audio (5+: voice, music, one track per SFX).
 * Every cue starts on a real spoken word's start time.
 */

import {
  HEAD_PIVOT,
  PRESENTER_H,
  PRESENTER_W,
  presenterSvg,
} from "@/lib/explainer-video/presenter";
import { normWord, wordStart, type TimedLine, type TimedWord } from "@/lib/explainer-video/timing";
import type { ExplainerPoint, ExplainerScript, Orientation } from "@/lib/explainer-video/types";

export const FPS = 30;
/** Voice starts after this, so frame 0 (and the matching last frame) is still. */
export const LEAD_IN = 0.2;

const INK = "#1E1C1A";
const RED = "#D7372C";
const GREY = "#8A857E";
const PAPER = "#EBE7E1";
const CARD = "#FBFAF8";
const CAPTION_GREY = "#B5AFA7";

const WIPE_TOTAL = 0.9;
const WIPE_PEAK = 0.45;
const COUNT_S = 1.15;
const HAND_S = 1.7;

type Layout = {
  w: number;
  h: number;
  side: number;
  labelY: number;
  caption: { x: number; y: number; w: number; size: number; chars: number };
  stage: { x: number; y: number; w: number; h: number };
  presenter: { x: number; y: number; scale: number };
  wipe: { cols: number; rows: number };
};

export function layoutFor(orientation: Orientation): Layout {
  if (orientation === "vertical") {
    return {
      w: 1080,
      h: 1920,
      side: 120,
      labelY: 132,
      caption: { x: 120, y: 196, w: 850, size: 62, chars: 26 },
      stage: { x: 120, y: 430, w: 840, h: 720 },
      presenter: { x: 430, y: 1170, scale: 1 },
      wipe: { cols: 13, rows: 23 },
    };
  }
  return {
    w: 1920,
    h: 1080,
    side: 96,
    labelY: 64,
    caption: { x: 96, y: 112, w: 1180, size: 62, chars: 36 },
    stage: { x: 96, y: 330, w: 1240, h: 690 },
    presenter: { x: 1428, y: 560, scale: 0.72 },
    wipe: { cols: 23, rows: 13 },
  };
}

// --- small helpers -------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** A GSAP timeline written as code lines, times relative to the scene start. */
class Tl {
  lines: string[] = [];
  constructor(private origin = 0) {}
  at(t: number) {
    return r3(Math.max(0, t - this.origin));
  }
  raw(code: string) {
    this.lines.push(code);
  }
  fromTo(sel: string, from: object, to: object, t: number) {
    this.lines.push(
      `tl.fromTo(${JSON.stringify(sel)}, ${JSON.stringify(from)}, ${JSON.stringify({ ...to, immediateRender: false })}, ${this.at(t)});`,
    );
  }
  to(sel: string, vars: object, t: number) {
    this.lines.push(`tl.to(${JSON.stringify(sel)}, ${JSON.stringify(vars)}, ${this.at(t)});`);
  }
  set(sel: string, vars: object, t: number) {
    this.lines.push(`tl.set(${JSON.stringify(sel)}, ${JSON.stringify(vars)}, ${this.at(t)});`);
  }
  // Motion vocabulary from the direction.
  pop(sel: string, t: number) {
    this.fromTo(sel, { scale: 0.55, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.34, ease: "back.out(2.2)" }, t);
  }
  rise(sel: string, t: number) {
    this.fromTo(sel, { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, t);
  }
  exit(sel: string, t: number) {
    this.to(sel, { y: "-=50", opacity: 0, duration: 0.22, ease: "power2.in" }, t);
  }
  slam(sel: string, t: number) {
    this.fromTo(sel, { scale: 1.22, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.24, ease: "power4.out" }, t);
  }
  stamp(sel: string, t: number) {
    this.fromTo(
      sel,
      { scale: 1.75, rotation: -18, opacity: 0 },
      { scale: 1, rotation: -6, opacity: 1, duration: 0.2, ease: "power3.out" },
      t,
    );
  }
  draw(sel: string, t: number, duration = 0.35) {
    this.fromTo(sel, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration, ease: "power2.out" }, t);
  }
  /** Count a number up with stepped text sets (no callbacks: seek-safe). */
  count(sel: string, value: number, suffix: string, t: number) {
    const steps = Math.round(COUNT_S * FPS / 2);
    for (let i = 0; i <= steps; i += 1) {
      const p = i / steps;
      const eased = 1 - Math.pow(1 - p, 3);
      this.set(sel, { textContent: `${Math.round(value * eased)}${suffix}` }, t + p * COUNT_S);
    }
  }
}

/** Seeded PRNG for blinks (fixed seed: same video every render). */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- shared markup -------------------------------------------------------------

const HALFTONE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><circle cx='4' cy='4' r='1.7' fill='${INK}'/></svg>`,
)}")`;

/** Fine noise grain: a pre-generated ink-speck tile (video-worker/assets/grain.png). */
const GRAIN = `url("../assets/grain.png")`;

/** Card with the halftone shadow (13 px left, 12 px down). */
function card(id: string, inner: string, cls = "", style = "") {
  return `<div id="${id}" class="cw ${cls}" style="${style}"><div class="sh"></div><div class="card">${inner}</div></div>`;
}

function header(prefix: string, label: string, statHtml: string, enter = true) {
  const cls = enter ? " enter" : "";
  return `<div id="${prefix}-hl" class="hdr hdr-l${cls}">${esc(label)}</div><div id="${prefix}-hr" class="hdr hdr-r${cls}">${statHtml}</div>`;
}

function statHtml(value: string, label: string) {
  return `<b>${esc(value)}</b> ${esc(label)}`;
}

/** Frame-0 state: shown at the start of the hook and again under the last wipe. */
function hookBase(prefix: string, script: ExplainerScript) {
  return `${header(prefix, `// 00 · ${script.topic.toLowerCase()}`, statHtml(String(script.points.length), "points"), false)}
  ${card(
    `${prefix}-problem`,
    `<div class="chrome"><i></i><i></i><i></i></div><p class="problem-text">${esc(script.problem)}</p>
     ${strikeSvg(`${prefix}-strike`)}`,
    "problem",
  )}`;
}

// Hand-drawn red strokes. Each viewBox is sized to its box (estimated from the
// text), so the stroke scales evenly and the pathLength=1 dash draw stays exact.

function strikeSvg(id?: string) {
  return `<svg class="strike" viewBox="0 0 800 40" preserveAspectRatio="none"><path${id ? ` id="${id}"` : ""} class="ln" pathLength="1" d="M10,26 C200,12 420,32 600,18 C680,12 740,14 790,20"/></svg>`;
}

function swashSvg(id: string, width: number) {
  const w = Math.max(80, Math.round(width));
  const f = (n: number) => Math.round(n);
  return `<svg class="swash" viewBox="0 0 ${w} 40" preserveAspectRatio="none"><path id="${id}" class="ln" pathLength="1" d="M6,28 C${f(w * 0.22)},12 ${f(w * 0.46)},34 ${f(w * 0.66)},20 C${f(w * 0.8)},11 ${f(w * 0.92)},14 ${w - 6},24"/></svg>`;
}

function ringSvg(id: string, label: string) {
  const w = Math.round(label.length * 21 + 66) + 68;
  const h = 104 + 64;
  const f = (n: number) => Math.round(n);
  return `<svg class="ring" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path id="${id}" class="ln" pathLength="1" d="M${f(w * 0.74)},${f(h * 0.1)} C${f(w * 0.97)},${f(h * 0.16)} ${f(w * 1.0)},${f(h * 0.55)} ${f(w * 0.88)},${f(h * 0.78)} C${f(w * 0.72)},${f(h * 0.99)} ${f(w * 0.2)},${f(h * 0.98)} ${f(w * 0.07)},${f(h * 0.74)} C${f(w * -0.02)},${f(h * 0.5)} ${f(w * 0.08)},${f(h * 0.12)} ${f(w * 0.36)},${f(h * 0.06)} C${f(w * 0.56)},${f(h * 0.02)} ${f(w * 0.7)},${f(h * 0.06)} ${f(w * 0.82)},${f(h * 0.16)}"/></svg>`;
}

// --- caption pages -------------------------------------------------------------

const STOP = new Set(
  "a an the and or but so to of in on at for with by from is are was were be been it its this that these those you your we our they their i my me he she his her as if then than into onto just not no do does did can will would should could have has had what which who how why when where there here all any some more most very".split(
    " ",
  ),
);

type CaptionLine = { words: TimedWord[]; key: number };
type CaptionPage = { lines: CaptionLine[]; start: number; end: number };

function captionPages(lines: TimedLine[], chars: number, priority: Set<string>): CaptionPage[] {
  const pages: CaptionPage[] = [];
  for (const line of lines) {
    let page: CaptionLine[] = [];
    let cur: TimedWord[] = [];
    let len = 0;
    const flushLine = () => {
      if (cur.length) page.push({ words: cur, key: -1 });
      cur = [];
      len = 0;
    };
    const flushPage = () => {
      flushLine();
      if (page.length) pages.push({ lines: page, start: page[0]!.words[0]!.start, end: 0 });
      page = [];
    };
    for (const word of line.words) {
      const add = word.text.length + (cur.length ? 1 : 0);
      if (len + add > chars && cur.length) {
        flushLine();
        if (page.length >= 2) flushPage();
      }
      cur.push(word);
      len += add;
    }
    flushPage();
  }
  for (let i = 0; i < pages.length; i += 1) {
    pages[i]!.end = pages[i + 1]?.start ?? Infinity;
    for (const cl of pages[i]!.lines) {
      let best = -1;
      let score = 0;
      cl.words.forEach((w, wi) => {
        if (STOP.has(w.norm) || w.norm.length < 3) return;
        const s = (priority.has(w.norm) ? 10 : 0) + w.norm.length;
        if (s > score) {
          score = s;
          best = wi;
        }
      });
      cl.key = best;
    }
  }
  return pages;
}

// --- demos ---------------------------------------------------------------------

type Demo = { html: string; animate: (tl: Tl, times: number[], end: number) => void };

function demoFor(p: ExplainerPoint, id: string, L: Layout): Demo {
  const items = p.demo.items;
  const vertical = L.w < L.h;
  const n = items.length;
  if (p.demo.kind === "flow") {
    const boxes = items
      .map(
        (item, i) =>
          `${card(`${id}-b${i}`, `<span class="step-n">${pad2(i + 1)}</span><span>${esc(item)}</span>`, "flow-box enter")}${
            i < n - 1 ? `<div id="${id}-a${i}" class="flow-arrow enter"><svg viewBox="0 0 40 40"><path class="ln-ink" d="${vertical ? "M20,4 L20,34 M10,24 L20,34 L30,24" : "M4,20 L34,20 M24,10 L34,20 L24,30"}"/></svg></div>` : ""
          }`,
      )
      .join("");
    return {
      html: `<div class="flow ${vertical ? "col" : "row"}">${boxes}</div><div id="${id}-dot" class="pulse-dot enter"></div>`,
      animate(tl, times, end) {
        times.forEach((t, i) => {
          tl.pop(`#${id}-b${i}`, t);
          if (i > 0) tl.fromTo(`#${id}-a${i - 1}`, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.25, ease: "power2.out" }, t - 0.12);
        });
        // The active-step dot keeps moving: hop to each box, pulse between.
        tl.fromTo(`#${id}-dot`, { opacity: 0 }, { opacity: 1, duration: 0.2 }, times[0]!);
        times.forEach((t, i) => {
          const box = `document.getElementById(${JSON.stringify(`${id}-b${i}`)})`;
          const x = vertical ? `${box}.offsetLeft - 52` : `${box}.offsetLeft + ${box}.offsetWidth / 2 - 15`;
          const y = vertical ? `${box}.offsetTop + ${box}.offsetHeight / 2 - 15` : `${box}.offsetTop - 52`;
          tl.raw(
            `tl.to(${JSON.stringify(`#${id}-dot`)}, { x: () => ${x}, y: () => ${y}, duration: ${i === 0 ? 0 : 0.3}, ease: "power2.out" }, ${tl.at(t)});`,
          );
        });
        pulse(tl, `#${id}-dot`, times[0]! + 0.3, end);
      },
    };
  }
  if (p.demo.kind === "compare") {
    const values = p.demo.values ?? items.map((_, i) => 30 + (i * 60) / Math.max(1, n - 1));
    const rows = items
      .map(
        (item, i) =>
          `<div id="${id}-r${i}" class="cmp-row enter"><span class="cmp-label">${esc(item)}</span><div class="cmp-track"><div id="${id}-bar${i}" class="cmp-bar${i === values.indexOf(Math.max(...values)) ? " hot" : ""}" style="width:${values[i]}%"></div></div><span id="${id}-v${i}" class="cmp-v">0</span></div>`,
      )
      .join("");
    return {
      html: card(`${id}-cmp`, rows, "cmp enter"),
      animate(tl, times, end) {
        tl.rise(`#${id}-cmp`, times[0]! - 0.2);
        times.forEach((t, i) => {
          tl.fromTo(`#${id}-r${i}`, { opacity: 0 }, { opacity: 1, duration: 0.15 }, t);
          tl.fromTo(`#${id}-bar${i}`, { scaleX: 0 }, { scaleX: 1, duration: COUNT_S, ease: "power3.out" }, t);
          tl.count(`#${id}-v${i}`, Math.round(values[i]!), "", t);
        });
        pulse(tl, `#${id}-bar${values.indexOf(Math.max(...values))}`, times[times.length - 1]! + COUNT_S, end, "scaleY");
      },
    };
  }
  if (p.demo.kind === "stack") {
    const rows = items
      .map(
        (item, i) =>
          card(
            `${id}-s${i}`,
            `<svg class="check" viewBox="0 0 40 40"><path id="${id}-c${i}" class="ln" pathLength="1" d="M6,22 L16,32 L34,8"/></svg><span>${esc(item)}</span>`,
            "stack-row enter",
          ),
      )
      .join("");
    return {
      html: `<div class="stack">${rows}</div>`,
      animate(tl, times, end) {
        times.forEach((t, i) => {
          tl.rise(`#${id}-s${i}`, t);
          tl.draw(`#${id}-c${i}`, t + 0.15, 0.25);
        });
        pulse(tl, `#${id}-s${n - 1}`, times[n - 1]! + 0.5, end);
      },
    };
  }
  // cycle
  const size = Math.min(L.stage.w, L.stage.h) - 80;
  const nodes = items
    .map((item, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = size / 2 + Math.cos(a) * (size / 2 - 40);
      const y = size / 2 + Math.sin(a) * (size / 2 - 40);
      return `<div class="cyc-node" style="left:${r3(x)}px;top:${r3(y)}px">${card(`${id}-n${i}`, esc(item), "cyc-card enter")}</div>`;
    })
    .join("");
  return {
    html: `<div class="cycle" style="width:${size}px;height:${size}px"><svg class="cyc-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r3(50 - (40 / size) * 100)}" class="ln-ink dashed"/></svg><div id="${id}-orbit" class="cyc-orbit enter"><i></i></div>${nodes}</div>`,
    animate(tl, times, end) {
      tl.fromTo(`#${id}-orbit`, { opacity: 0, rotation: 0 }, { opacity: 1, duration: 0.2 }, times[0]!);
      tl.fromTo(
        `#${id}-orbit`,
        { rotation: 0 },
        { rotation: 360 * Math.max(1, Math.round((end - times[0]!) / 2.4)), duration: Math.max(0.5, end - times[0]!), ease: "none" },
        times[0]!,
      );
      times.forEach((t, i) => tl.pop(`#${id}-n${i}`, t));
    },
  };
}

/** Gentle repeating scale pulse so nothing sits still for over a second. */
function pulse(tl: Tl, sel: string, from: number, to: number, prop: "scale" | "scaleY" = "scale") {
  for (let t = from; t + 0.8 <= to; t += 0.8) {
    tl.to(sel, { [prop]: 1.04, duration: 0.4, ease: "sine.inOut" }, t);
    tl.to(sel, { [prop]: 1, duration: 0.4, ease: "sine.inOut" }, t + 0.4);
  }
}

// --- the composition ----------------------------------------------------------

export type SfxName = "pop" | "whoosh" | "tick-roll" | "typing" | "thud";
export type SfxInfo = Record<SfxName, { peak: number; duration: number }>;

export type ComposeInput = {
  script: ExplainerScript;
  orientation: Orientation;
  /** Aligned lines, times already shifted by LEAD_IN (film time). */
  lines: TimedLine[];
  /** Mouth shape per 30 fps frame of the voice file. */
  mouth: number[];
  voiceDuration: number;
  sfx: SfxInfo;
  gsapFile: string;
};

export type Composed = {
  files: Record<string, string>;
  duration: number;
  /** Frames to review before rendering: frame 1, each point built and acted out, the close. */
  review: Array<{ label: string; time: number }>;
};

type Scene = { id: string; start: number; end: number; html: string; css: string; tl: Tl };

export function composeExplainer(input: ComposeInput): Composed {
  const { script, lines } = input;
  const L = layoutFor(input.orientation);
  const sounds: Array<{ name: SfxName; at: number; duration?: number }> = [];
  const sfx = (name: SfxName, at: number, duration?: number) => sounds.push({ name, at, duration });

  const hook1 = lines[0]!;
  const hook2 = lines[1]!;
  const pointLine = (k: number) => lines[2 + 2 * k]!;
  const pointExpl = (k: number) => lines[3 + 2 * k]!;
  const closing = lines[lines.length - 1]!;
  const nPoints = script.points.length;

  // Scene boundaries. Wipes before point 1 and before the last point (peak 0.3 s
  // before the line); other changes cut 0.08 s before the line after an exit.
  const wipeBefore = (k: number) => k === 0 || k === nPoints - 1;
  const pointStart = (k: number) => pointLine(k).start - (wipeBefore(k) ? 0.3 : 0.08);
  const closingStart = closing.start - 0.08;
  const finalWipe = closing.end + 0.1;
  // Two spare frames after the last wipe so the corner dots are fully gone: last frame = frame 0.
  const duration = r3(finalWipe + WIPE_TOTAL + 2 / FPS);
  const wipes = [
    ...script.points.map((_, k) => k).filter(wipeBefore).map((k) => pointStart(k) - WIPE_PEAK),
    finalWipe,
  ];

  const scenes: Scene[] = [];
  const review: Composed["review"] = [{ label: "Frame 1", time: 0 }];

  // Hook ---------------------------------------------------------------------
  {
    const id = "hook";
    const end = pointStart(0);
    const tl = new Tl(0);
    const strikeAt = hook1.words[hook1.words.length - 1]!.start;
    tl.draw(`#${id}-strike`, strikeAt, 0.35);
    const popAt = hook2.start;
    script.payoff.forEach((_, i) => {
      tl.pop(`#${id}-pay${i}`, popAt + i * 0.16);
      sfx("pop", popAt + i * 0.16);
    });
    const ringAt = Math.max(wordStart(hook2, script.payoffWord), popAt + (script.payoff.length - 1) * 0.16 + 0.34);
    tl.draw(`#${id}-ring`, ringAt, 0.45);
    pulse(tl, `#${id}-pay${script.payoff.length - 1}`, ringAt + 0.5, end - 0.1);
    const payoff = script.payoff
      .map((label, i) =>
        card(
          `${id}-pay${i}`,
          `<span>${esc(label)}</span>${i === script.payoff.length - 1 ? ringSvg(`${id}-ring`, label) : ""}`,
          "pay enter",
        ),
      )
      .join("");
    scenes.push({
      id,
      start: 0,
      end,
      tl,
      css: "",
      html: `${hookBase(id, script)}<div class="stage hook-stage"><div class="pay-row">${payoff}</div></div>`,
    });
  }

  // Points -------------------------------------------------------------------
  script.points.forEach((p, k) => {
    const id = `p${k + 1}`;
    const start = pointStart(k);
    const end = k + 1 < nPoints ? pointStart(k + 1) : closingStart;
    const line = pointLine(k);
    const expl = pointExpl(k);
    const tl = new Tl(start);

    // Header updates as the scene opens.
    tl.fromTo(`#${id}-hl`, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, start + 0.02);
    tl.fromTo(`#${id}-hr`, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, start + 0.08);
    if (!wipeBefore(k)) sfx("whoosh", start);

    const exitAt = expl.start - 0.3;
    const cap = (t: number) => Math.min(t, exitAt - 0.05);
    const t1 = wordStart(line, p.title[0]);
    const t2 = wordStart(line, p.title[1], t1 + 0.01);
    tl.slam(`#${id}-w1`, t1);
    tl.slam(`#${id}-w2`, t2);
    tl.draw(`#${id}-swash`, cap(t2 + 0.12), 0.35);
    const cardAt = cap(t2 + 0.3);
    tl.rise(`#${id}-card`, cardAt);
    sfx("pop", cardAt);
    tl.count(`#${id}-num`, p.stat.value, p.stat.suffix, cardAt);
    sfx("tick-roll", cardAt);
    const badgeAt = cap(cardAt + 0.6);
    tl.fromTo(`#${id}-badge`, { rotation: -200, scale: 0.4, opacity: 0 }, { rotation: 0, scale: 1, opacity: 1, duration: 0.38, ease: "back.out(2)" }, badgeAt);
    const barAt = cap(cardAt + 0.25);
    tl.rise(`#${id}-bar`, barAt);
    const typeAt = cap(barAt + 0.2);
    const typeDur = Math.max(0.3, Math.min(0.85, p.typed.length * 0.034, exitAt - typeAt - 0.05));
    tl.fromTo(
      `#${id}-typed`,
      { width: "0ch" },
      { width: `${p.typed.length}ch`, duration: typeDur, ease: `steps(${p.typed.length})` },
      typeAt,
    );
    sfx("typing", typeAt, typeDur);
    pulse(tl, `#${id}-caret`, typeAt + typeDur, exitAt);

    // Everything exits upward 0.3 s before the explanation; the demo acts it out.
    tl.exit(`#${id}-intro .x`, exitAt);
    sfx("whoosh", exitAt);
    const demo = demoFor(p, `${id}-d`, L);
    const nWords = expl.words.length;
    const times: number[] = [];
    p.demo.items.forEach((item, i) => {
      const prev = times[i - 1] ?? expl.start - 0.01;
      const said = expl.words.find((w) => w.norm === normWord(item.split(/\s+/)[0] ?? "") && w.start > prev);
      const fallback = expl.words[Math.min(nWords - 1, Math.floor((i * nWords) / p.demo.items.length))]!.start;
      times.push(Math.max(prev + 0.16, said?.start ?? fallback, expl.start));
    });
    const demoEnd = k + 1 < nPoints && !wipeBefore(k + 1) ? end - 0.22 : end;
    const label = `${pad2(k + 1)} · ${p.name}`;
    review.push({ label: `${label} · intro`, time: r3(exitAt - 0.06) });
    const demoShown = k + 1 >= nPoints ? demoEnd - 0.22 : wipeBefore(k + 1) ? end - WIPE_PEAK : demoEnd;
    review.push({ label: `${label} · demo`, time: r3(demoShown - 0.15) });
    tl.fromTo(`#${id}-demo`, { opacity: 0 }, { opacity: 1, duration: 0.01 }, expl.start - 0.05);
    demo.animate(tl, times, demoEnd);
    const stampAt = wordStart(expl, p.stampWord, expl.start - 0.01);
    tl.stamp(`#${id}-stamp`, stampAt);
    sfx("thud", stampAt);
    if (k + 1 < nPoints && !wipeBefore(k + 1)) {
      tl.exit(`#${id}-demo, #${id}-stamp`, demoEnd);
      sfx("whoosh", demoEnd);
    } else if (k + 1 >= nPoints) {
      tl.exit(`#${id}-demo, #${id}-stamp`, demoEnd - 0.22);
      sfx("whoosh", demoEnd - 0.22);
    }

    const titleChars = p.title.join(" ").length;
    const oneLine = Math.min(176, L.stage.w / (titleChars * 0.5));
    const twoLine = Math.min(176, 150, L.stage.w / (Math.max(...p.title.map((w) => w.length)) * 0.5));
    const stacked = oneLine < 118;
    const size = Math.floor(stacked ? twoLine : oneLine);
    const statValue = `${p.stat.value}${p.stat.suffix}`;
    scenes.push({
      id,
      start,
      end,
      tl,
      css: `#${id}-title{font-size:${size}px}`,
      html: `${header(id, `// ${pad2(k + 1)} · ${p.name.toLowerCase()}`, statHtml(statValue, p.stat.label))}
      <div id="${id}-intro" class="stage point-stage">
        <h2 id="${id}-title" class="title x${stacked ? " stacked" : ""}"><span id="${id}-w1" class="w1 enter">${esc(p.title[0])}</span> <span id="${id}-w2" class="w2 enter">${esc(p.title[1])}${swashSvg(`${id}-swash`, p.title[1].length * size * 0.5)}</span></h2>
        <div class="point-row">
          ${card(`${id}-card`, `<div id="${id}-num" class="num">0${esc(p.stat.suffix)}</div><p class="card-text">${esc(p.card)}</p><div id="${id}-badge" class="badge enter">#${k + 1}</div>`, "main-card x enter")}
          <div id="${id}-bar" class="bar ${p.bar} x enter">${p.bar === "terminal" ? `<span class="prompt">$</span>` : `<svg class="mag" viewBox="0 0 30 30"><circle cx="12" cy="12" r="8" class="ln-ink"/><path d="M18,18 L27,27" class="ln-ink"/></svg>`}<span id="${id}-typed" class="typed">${esc(p.typed)}</span><span id="${id}-caret" class="caret"></span></div>
        </div>
      </div>
      <div id="${id}-demo" class="stage demo-stage enter">${demo.html}</div>
      <div id="${id}-stamp" class="stamp enter">${esc(p.stamp)}</div>`,
    });
  });

  // Closing -------------------------------------------------------------------
  {
    const id = "outro";
    const tl = new Tl(closingStart);
    tl.fromTo(`#${id}-hl`, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, closingStart + 0.02);
    tl.fromTo(`#${id}-hr`, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, closingStart + 0.08);
    sfx("whoosh", closingStart);
    tl.fromTo(`#${id}-problem2`, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, closing.start);
    script.payoff.forEach((_, i) => {
      tl.pop(`#${id}-pay${i}`, closing.start + 0.2 + i * 0.16);
      sfx("pop", closing.start + 0.2 + i * 0.16);
    });
    const ringWord = closing.words.find((w) => w.norm === normWord(script.payoffWord)) ?? closing.words[Math.floor(closing.words.length / 2)]!;
    const ringAt = Math.max(ringWord.start, closing.start + 0.2 + script.payoff.length * 0.16 + 0.2);
    tl.draw(`#${id}-ring`, ringAt, 0.45);
    pulse(tl, `#${id}-pay${script.payoff.length - 1}`, ringAt + 0.5, finalWipe + WIPE_PEAK);
    // Under the last wipe the frame turns back into frame 0, so the reel loops.
    tl.set(`#${id}-closing`, { opacity: 0 }, finalWipe + WIPE_PEAK);
    tl.set(`#${id}-base`, { opacity: 1 }, finalWipe + WIPE_PEAK);
    const payoff = script.payoff
      .map((label, i) =>
        card(`${id}-pay${i}`, `<span>${esc(label)}</span>${i === script.payoff.length - 1 ? ringSvg(`${id}-ring`, label) : ""}`, "pay enter"),
      )
      .join("");
    scenes.push({
      id,
      start: closingStart,
      end: duration,
      tl,
      css: `#${id}-problem2 .strike path{stroke-dashoffset:0}`,
      html: `<div id="${id}-closing">${header(id, "// recap", statHtml(String(nPoints), "points"))}
        <div class="stage hook-stage">${card(`${id}-problem2`, `<div class="chrome"><i></i><i></i><i></i></div><p class="problem-text">${esc(script.problem)}</p>${strikeSvg()}`, "problem enter")}<div class="pay-row">${payoff}</div></div></div>
        <div id="${id}-base" class="base">${hookBase(`${id}b`, script)}</div>`,
    });
  }

  // Root timeline: presenter, captions, wipes ------------------------------------
  const root = new Tl(0);
  const priority = new Set(
    [
      ...script.points.flatMap((p) => [...p.title, p.stampWord, ...p.demo.items]),
      script.payoffWord,
      ...script.topic.split(/\s+/),
    ]
      .flatMap((s) => s.split(/\s+/))
      .map(normWord)
      .filter(Boolean),
  );
  const pages = captionPages(lines, L.caption.chars, priority);
  const keyTimes: number[] = [];
  const captionHtml = pages
    .map((page, pi) => {
      const body = page.lines
        .map(
          (cl, li) =>
            `<div class="cap-line">${cl.words
              .map((w, wi) => {
                const key = wi === cl.key;
                if (key) keyTimes.push(w.start);
                return `<span id="c${pi}-${li}-${wi}" class="cw-word${key ? " key" : ""}">${esc(w.text.replace(/\./g, ""))}</span>`;
              })
              .join(" ")}</div>`,
        )
        .join("");
      return `<div id="cap${pi}" class="cap-page">${body}</div>`;
    })
    .join("");
  pages.forEach((page, pi) => {
    root.set(`#cap${pi}`, { opacity: 1 }, page.start);
    root.set(`#cap${pi}`, { opacity: 0 }, Math.min(page.end, finalWipe + WIPE_PEAK));
    page.lines.forEach((cl, li) =>
      cl.words.forEach((w, wi) => {
        const key = wi === cl.key;
        // Appears grey on the frame it's spoken, turns ink (key word: red) in 0.2 s.
        root.set(`#c${pi}-${li}-${wi}`, { opacity: 1 }, w.start);
        root.fromTo(
          `#c${pi}-${li}-${wi}`,
          { color: CAPTION_GREY },
          { color: key ? RED : INK, duration: 0.2, ease: "none" },
          w.start,
        );
      }),
    );
  });

  // Presenter: mouth from loudness, blinks, sway, nods, hands.
  let lastShape = -1;
  input.mouth.forEach((shape, f) => {
    if (shape === lastShape) return;
    lastShape = shape;
    root.set("#pr-mouth", { attr: { href: `#pr-m${shape}` } }, LEAD_IN + f / FPS);
  });
  if (lastShape !== 0) root.set("#pr-mouth", { attr: { href: "#pr-m0" } }, LEAD_IN + input.mouth.length / FPS);

  const rand = mulberry32(20261030);
  for (let t = 0.8 + rand() * 1.2; t < duration - 0.5; t += 2.4 + rand() * 1.8) {
    root.set("#pr-lid-half", { opacity: 1 }, t);
    root.set("#pr-lid-full", { opacity: 1 }, t + 0.047);
    root.set("#pr-lid-full", { opacity: 0 }, t + 0.093);
    root.set("#pr-lid-half", { opacity: 0 }, t + 0.14);
  }

  // Sway: always moving, at rest on the first and last frame.
  const swayPeriod = 1.7;
  const swings = Math.max(2, Math.floor((duration - 0.4) / swayPeriod));
  const swing = (duration - 0.4) / swings;
  for (let i = 0; i < swings; i += 1) {
    const target = i === swings - 1 ? 0 : i % 2 === 0 ? 1.8 : -1.8;
    root.to("#pr-head-sway", { rotation: target, svgOrigin: HEAD_PIVOT, duration: swing, ease: "sine.inOut" }, 0.2 + i * swing);
  }
  let lastNod = -Infinity;
  for (const t of keyTimes.sort((a, b) => a - b)) {
    if (t - lastNod < 0.55) continue;
    lastNod = t;
    root.to("#pr-head-nod", { y: 9, rotation: 2.2, svgOrigin: HEAD_PIVOT, duration: 0.2, ease: "power2.out" }, t);
    root.to("#pr-head-nod", { y: 0, rotation: 0, svgOrigin: HEAD_PIVOT, duration: 0.3, ease: "power2.inOut" }, t + 0.2);
    root.to("#pr-brows", { y: -9, duration: 0.15, ease: "power2.out" }, t);
    root.to("#pr-brows", { y: 0, duration: 0.3, ease: "power2.inOut" }, t + 0.2);
  }
  const hand = (sel: string, t: number) => {
    root.to(sel, { y: 0, duration: 0.35, ease: "power3.out" }, t);
    root.to(sel, { y: 440, duration: 0.3, ease: "power2.in" }, t + HAND_S - 0.3);
  };
  let pointHandFree = 0;
  let palmFree = 0;
  script.points.forEach((p, k) => {
    const t = wordStart(pointLine(k), p.title[0]) - 0.2;
    if (t >= pointHandFree) {
      hand("#pr-hand-point", t);
      pointHandFree = t + HAND_S;
    }
    const e = pointExpl(k).start;
    if (k % 2 === 1 && e >= palmFree) {
      hand("#pr-hand-palm", e);
      palmFree = e + HAND_S;
    }
  });

  // Halftone dot wipes: grow from the centre out, then shrink away (0.9 s).
  for (const w of wipes) {
    root.fromTo(
      ".wd",
      { scale: 0, opacity: 1 },
      { scale: 1, opacity: 1, duration: 0.3, ease: "power2.out", stagger: { amount: 0.15, from: "center", grid: [L.wipe.rows, L.wipe.cols] } },
      w,
    );
    root.to(
      ".wd",
      { scale: 0, duration: 0.3, ease: "power2.in", stagger: { amount: 0.15, from: "center", grid: [L.wipe.rows, L.wipe.cols] } },
      w + WIPE_PEAK,
    );
    sfx("whoosh", w + 0.1);
  }
  const pitchX = L.w / L.wipe.cols;
  const pitchY = L.h / L.wipe.rows;
  const dots: string[] = [];
  for (let r = 0; r < L.wipe.rows; r += 1) {
    for (let c = 0; c < L.wipe.cols; c += 1) {
      dots.push(
        `<i class="wd" style="left:${r3(c * pitchX + pitchX / 2 - 31)}px;top:${r3(r * pitchY + pitchY / 2 - 31)}px"></i>`,
      );
    }
  }

  // Audio: voice, music, one track per sound effect with its loudest point on the cue.
  const audio: string[] = [
    `<audio id="a-voice" src="assets/voice.wav" data-start="${LEAD_IN}" data-duration="${r3(input.voiceDuration)}" data-volume="1" data-track-index="5"></audio>`,
    `<audio id="a-music" src="assets/music.mp3" data-start="0" data-duration="${duration}" data-volume="0.16" data-fade-out="0.8" data-track-index="6" loop></audio>`,
  ];
  const volume: Record<SfxName, number> = { pop: 0.5, whoosh: 0.45, "tick-roll": 0.35, typing: 0.4, thud: 0.6 };
  sounds
    .filter((s) => s.at < duration - 0.05)
    .sort((a, b) => a.at - b.at)
    .forEach((s, i) => {
      const info = input.sfx[s.name];
      const start = Math.max(0, s.at - info.peak);
      const dur = Math.min(s.duration ?? info.duration, info.duration, duration - start);
      audio.push(
        `<audio id="a-sfx-${i}" src="assets/sfx/${s.name}.mp3" data-start="${r3(start)}" data-duration="${r3(dur)}" data-volume="${volume[s.name]}" data-track-index="${7 + i}"></audio>`,
      );
    });

  // Files ----------------------------------------------------------------------
  const files: Record<string, string> = {};
  files["src/styles.css"] = stylesheet(L);
  for (const scene of scenes) {
    files[`compositions/${scene.id}.html`] = `<template>
  <style>
    #${scene.id}-root { position: absolute; inset: 0; width: ${L.w}px; height: ${L.h}px; }
    ${scene.css}
  </style>
  <div id="${scene.id}-root" data-composition-id="${scene.id}" data-width="${L.w}" data-height="${L.h}">
    ${scene.html}
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });
      ${scene.tl.lines.join("\n      ")}
      window.__timelines = window.__timelines || {};
      window.__timelines["${scene.id}"] = tl;
    })();
  </script>
</template>
`;
  }

  const sceneHosts = scenes
    .map(
      (s) =>
        `<div id="host-${s.id}" class="clip scene" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${r3(s.start)}" data-duration="${r3(s.end - s.start)}" data-track-index="1" data-width="${L.w}" data-height="${L.h}"></div>`,
    )
    .join("\n      ");

  files["index.html"] = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${L.w}, height=${L.h}" />
    <script src="${input.gsapFile}"></script>
    <link rel="stylesheet" href="src/styles.css" />
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-fps="${FPS}" data-width="${L.w}" data-height="${L.h}">
      <div id="paper" class="clip" data-start="0" data-duration="${duration}" data-track-index="0"></div>
      ${sceneHosts}
      <div id="presenter" class="clip" data-start="0" data-duration="${duration}" data-track-index="2">
        <div class="pr-box" style="left:${L.presenter.x}px;top:${L.presenter.y}px;transform:scale(${L.presenter.scale})">${presenterSvg()}</div>
      </div>
      <div id="captions" class="clip" data-start="0" data-duration="${duration}" data-track-index="3">${captionHtml}</div>
      <div id="wipes" class="clip" data-start="0" data-duration="${duration}" data-track-index="4">${dots.join("")}</div>
      ${audio.join("\n      ")}
    </div>
    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
        ${root.lines.join("\n        ")}
        window.__timelines = window.__timelines || {};
        window.__timelines["main"] = tl;
      })();
    </script>
  </body>
</html>
`;

  return {
    files,
    duration,
    review: [
      { label: "Hook", time: r3(pointStart(0) - WIPE_PEAK - 0.1) },
      ...review,
      { label: "Closing", time: r3(finalWipe - 0.05) },
    ].sort((a, b) => a.time - b.time),
  };
}

// --- stylesheet ----------------------------------------------------------------

function stylesheet(L: Layout): string {
  const vertical = L.w < L.h;
  return `@font-face { font-family: "Instrument Sans"; font-weight: 500; src: url("../assets/fonts/instrument-sans-latin-500-normal.woff2") format("woff2"); }
@font-face { font-family: "Instrument Serif"; font-style: italic; font-weight: 400; src: url("../assets/fonts/instrument-serif-latin-400-italic.woff2") format("woff2"); }
@font-face { font-family: "Anton"; font-weight: 400; src: url("../assets/fonts/anton-latin-400-normal.woff2") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 400; src: url("../assets/fonts/jetbrains-mono-latin-400-normal.woff2") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 700; src: url("../assets/fonts/jetbrains-mono-latin-700-normal.woff2") format("woff2"); }

* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${L.w}px; height: ${L.h}px; overflow: hidden; background: ${PAPER}; }
#root { position: relative; width: ${L.w}px; height: ${L.h}px; overflow: hidden; font-family: "Instrument Sans", sans-serif; font-weight: 500; color: ${INK}; }
.clip { position: absolute; inset: 0; }
#paper { background-color: ${PAPER}; background-image: ${GRAIN}; z-index: 0; }
.scene { z-index: 1; }
#presenter { z-index: 2; pointer-events: none; }
#captions { z-index: 3; }
#wipes { z-index: 4; }

/* Hidden from frame 1 by CSS; timelines bring them in. */
.enter { opacity: 0; }
.ln { fill: none; stroke: ${RED}; stroke-width: 8; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
.ln-ink { fill: none; stroke: ${INK}; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.ln-ink.dashed { stroke: ${GREY}; stroke-width: 0.8; stroke-dasharray: 2 2.4; }

.hdr { position: absolute; top: ${L.labelY}px; font-family: "JetBrains Mono", monospace; font-size: 25px; color: ${GREY}; white-space: nowrap; }
.hdr-l { left: ${L.side}px; }
.hdr-r { right: ${L.side}px; }
.hdr b { color: ${RED}; font-weight: 700; }

.cw { position: relative; }
.cw > .sh { position: absolute; inset: 0; border-radius: 20px; transform: translate(-13px, 12px); background-image: ${HALFTONE}; }
.cw > .card { position: relative; background: ${CARD}; border: 3px solid ${INK}; border-radius: 20px; }

.stage { position: absolute; left: ${L.stage.x}px; top: ${L.stage.y}px; width: ${L.stage.w}px; height: ${L.stage.h}px; }

/* Hook */
.problem { position: absolute; left: ${L.stage.x}px; top: ${L.stage.y}px; width: ${vertical ? L.stage.w : 820}px; }
.hook-stage .problem { position: relative; left: 0; top: 0; }
.problem .card { padding: 30px 40px 46px; }
.chrome { display: flex; gap: 10px; margin-bottom: 22px; }
.chrome i { width: 16px; height: 16px; border-radius: 50%; border: 3px solid ${INK}; }
.chrome i:first-child { background: ${RED}; }
.problem-text { font-size: ${vertical ? 64 : 60}px; line-height: 1.08; letter-spacing: -0.02em; }
.strike { position: absolute; left: 24px; width: calc(100% - 48px); top: 54%; height: 40px; overflow: visible; }
.strike .ln { stroke-width: 12; }
.hook-stage { top: ${vertical ? L.stage.y + 420 : L.stage.y + 300}px; height: auto; }
#outro-closing .hook-stage { top: ${L.stage.y}px; }
.pay-row { display: flex; gap: 28px; flex-wrap: wrap; margin-top: ${vertical ? 0 : 0}px; }
#outro-closing .pay-row { margin-top: 56px; }
.pay .card { padding: 22px 30px; font-size: 40px; letter-spacing: -0.01em; white-space: nowrap; }
.ring { position: absolute; left: -34px; top: -30px; width: calc(100% + 68px); height: calc(100% + 64px); overflow: visible; pointer-events: none; }
.ring .ln { stroke-width: 7; }
.base { position: absolute; inset: 0; opacity: 0; }

/* Points */
.title { font-family: "Anton", sans-serif; font-weight: 400; line-height: 0.98; text-transform: uppercase; letter-spacing: 0.005em; white-space: nowrap; }
.title.stacked .w1, .title.stacked .w2 { display: block; width: max-content; }
.title .w1, .title .w2 { display: inline-block; transform-origin: 30% 60%; }
.title .w2 { color: ${RED}; position: relative; }
.swash { position: absolute; left: -2%; width: 104%; bottom: -34px; height: 40px; overflow: visible; }
.swash .ln { stroke-width: 10; }
.point-stage { display: flex; flex-direction: column; gap: ${vertical ? 54 : 46}px; }
.point-row { display: flex; flex-direction: ${vertical ? "column" : "row"}; gap: ${vertical ? 44 : 48}px; align-items: ${vertical ? "stretch" : "center"}; }
.main-card { ${vertical ? "" : "flex: 0 0 600px;"} }
.main-card .card { padding: 26px 36px 30px; }
.num { font-family: "Anton", sans-serif; font-size: ${vertical ? 132 : 120}px; line-height: 1; }
.card-text { font-size: 36px; line-height: 1.2; margin-top: 10px; max-width: 560px; }
.badge { position: absolute; right: 26px; top: 24px; width: 92px; height: 92px; border-radius: 50%; background: ${RED}; color: ${CARD}; font-family: "Anton", sans-serif; font-size: 42px; display: grid; place-items: center; border: 3px solid ${INK}; }
.bar { display: flex; align-items: center; gap: 16px; height: 88px; padding: 0 28px; border-radius: 20px; border: 3px solid ${INK}; font-family: "JetBrains Mono", monospace; font-size: 30px; white-space: nowrap; ${vertical ? "" : "flex: 1;"} }
.bar.terminal { background: ${INK}; color: ${CARD}; }
.bar.terminal .prompt { color: ${RED}; font-weight: 700; }
.bar.search { background: ${CARD}; border-radius: 44px; }
.mag { width: 34px; height: 34px; }
.typed { display: inline-block; overflow: hidden; width: 0ch; white-space: pre; }
.caret { display: inline-block; width: 4px; height: 38px; background: ${RED}; }

/* Demos */
.demo-stage { display: grid; place-items: center; }
.flow { display: flex; align-items: center; gap: 14px; }
.flow.col { flex-direction: column; }
.flow-box .card { display: flex; align-items: center; gap: 22px; padding: 24px 34px; font-size: 42px; white-space: nowrap; min-width: ${vertical ? 520 : 240}px; }
.step-n { font-family: "JetBrains Mono", monospace; font-size: 26px; color: ${RED}; font-weight: 700; }
.flow-arrow svg { width: 48px; height: 48px; display: block; }
.pulse-dot { position: absolute; left: 0; top: 0; width: 30px; height: 30px; border-radius: 50%; background: ${RED}; border: 3px solid ${INK}; }
.cmp { width: 100%; }
.cmp .card { padding: 34px 40px; display: flex; flex-direction: column; gap: 30px; }
.cmp-row { display: grid; grid-template-columns: ${vertical ? "200px" : "260px"} 1fr 110px; align-items: center; gap: 24px; font-size: 36px; }
.cmp-label { white-space: nowrap; overflow: hidden; }
.cmp-track { height: 46px; border: 3px solid ${INK}; border-radius: 12px; overflow: hidden; background: ${PAPER}; }
.cmp-bar { height: 100%; background: ${GREY}; transform-origin: 0 50%; }
.cmp-bar.hot { background: ${RED}; }
.cmp-v { font-family: "Anton", sans-serif; font-size: 52px; text-align: right; }
.stack { display: flex; flex-direction: column; gap: 26px; width: 100%; }
.stack-row .card { display: flex; align-items: center; gap: 24px; padding: 22px 30px; font-size: 42px; }
.check { width: 50px; height: 50px; flex: none; border: 3px solid ${INK}; border-radius: 12px; overflow: visible; }
.check .ln { stroke-width: 8; }
.cycle { position: relative; }
.cyc-ring { position: absolute; inset: 0; width: 100%; height: 100%; }
.cyc-orbit { position: absolute; inset: 0; }
.cyc-orbit i { position: absolute; left: 50%; top: 22px; width: 34px; height: 34px; margin-left: -17px; border-radius: 50%; background: ${RED}; border: 3px solid ${INK}; }
.cyc-node { position: absolute; transform: translate(-50%, -50%); }
.cyc-card .card { padding: 18px 26px; font-size: 36px; white-space: nowrap; }

.stamp { position: absolute; right: ${vertical ? L.side : L.w - (L.stage.x + L.stage.w)}px; top: ${L.stage.y - (vertical ? 70 : 60)}px; font-family: "Anton", sans-serif; font-size: 52px; color: ${RED}; border: 5px solid ${RED}; padding: 4px 22px; text-transform: uppercase; background: ${PAPER}; }

/* Captions: a normal block (inline words in flex lose their spaces). */
.cap-page { position: absolute; left: ${L.caption.x}px; top: ${L.caption.y}px; width: ${L.caption.w}px; opacity: 0; font-size: ${L.caption.size}px; line-height: 1.18; letter-spacing: -0.015em; }
.cap-line { display: block; white-space: nowrap; }
.cw-word { color: ${CAPTION_GREY}; opacity: 0; }
.cw-word.key { font-family: "Instrument Serif", serif; font-style: italic; font-weight: 400; font-size: 1.16em; color: ${CAPTION_GREY}; }

/* Presenter */
.pr-box { position: absolute; width: ${PRESENTER_W}px; height: ${PRESENTER_H}px; transform-origin: 0 0; }
.pr-box svg { display: block; overflow: visible; }
#pr-lid-half, #pr-lid-full { opacity: 0; }

/* Wipes */
.wd { position: absolute; width: 62px; height: 62px; border-radius: 50%; background: ${INK}; opacity: 0; }
`;
}
