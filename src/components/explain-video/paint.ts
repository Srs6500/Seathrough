import { APP_COLORS, LOOK_COLORS, type Look, type Plan } from "@/lib/explain-video/film";

export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;

export type FontSet = {
  display: string;
  sans: string;
  mono: string;
};

export type PlanStage = "writing" | "checking";

type Colors = (typeof LOOK_COLORS)[Look];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOut(value: number): number {
  const t = clamp(value, 0, 1);
  return 1 - (1 - t) ** 3;
}

function reveal(time: number, delay: number, duration = 0.55): number {
  return easeOut((time - delay) / duration);
}

/** Seeded 0..1 so the paper speckle does not shimmer between frames. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintPaper(ctx: CanvasRenderingContext2D, colors: Colors) {
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  const random = seeded(7);
  ctx.save();
  ctx.fillStyle = colors.ink;
  ctx.globalAlpha = 0.05;
  for (let k = 0; k < 1600; k += 1) {
    const size = 1 + random() * 1.6;
    ctx.fillRect(random() * FRAME_WIDTH, random() * FRAME_HEIGHT, size, size);
  }
  ctx.restore();
}

/** A pen line that wanders a little, drawn on up to `progress`. */
function handLine(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  progress: number,
  seed: number,
) {
  if (progress <= 0 || points.length < 2) return;
  const random = seeded(seed);
  const dense: Array<[number, number]> = [];
  for (let k = 0; k < points.length - 1; k += 1) {
    const [x0, y0] = points[k]!;
    const [x1, y1] = points[k + 1]!;
    const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 18));
    for (let s = 0; s < steps; s += 1) {
      const u = s / steps;
      dense.push([x0 + (x1 - x0) * u + (random() - 0.5) * 2.4, y0 + (y1 - y0) * u + (random() - 0.5) * 2.4]);
    }
  }
  dense.push(points[points.length - 1]!);
  const count = Math.max(2, Math.round(dense.length * clamp(progress, 0, 1)));
  ctx.beginPath();
  dense.slice(0, count).forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (ctx.measureText(trial).width <= maxWidth || !current) {
      current = trial;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && lines.join(" ").length < words.join(" ").length) {
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, draw: () => void) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  draw();
  ctx.restore();
}

function kicker(ctx: CanvasRenderingContext2D, fonts: FontSet, text: string, x: number, y: number, color: string) {
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  ctx.font = `500 26px ${fonts.mono}`;
  spaced.letterSpacing = "0.24em";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text.toUpperCase(), x, y);
  spaced.letterSpacing = "0px";
}

export function paintPlan(
  ctx: CanvasRenderingContext2D,
  fonts: FontSet,
  plan: Plan,
  time: number,
  stage: PlanStage,
) {
  const colors = LOOK_COLORS[plan.look];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textBaseline = "top";
  paintPaper(ctx, colors);

  withAlpha(ctx, reveal(time, 0.05), () => kicker(ctx, fonts, "The plan", FRAME_WIDTH / 2, 110, colors.accent));
  withAlpha(ctx, reveal(time, 0.12), () => {
    ctx.font = `600 66px ${fonts.display}`;
    ctx.fillStyle = colors.ink;
    ctx.textAlign = "center";
    wrap(ctx, plan.title, 1500, 1).forEach((line) => ctx.fillText(line, FRAME_WIDTH / 2, 160));
  });
  withAlpha(ctx, reveal(time, 0.26), () => {
    ctx.font = `400 32px ${fonts.sans}`;
    ctx.fillStyle = colors.mute;
    ctx.textAlign = "center";
    wrap(ctx, plan.angle, 1300, 2).forEach((line, k) => ctx.fillText(line, FRAME_WIDTH / 2, 262 + k * 44));
  });

  const scenes = plan.scenes.slice(0, 7);
  const rowGap = scenes.length > 5 ? 66 : 80;
  const top = 400;
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  handLine(ctx, [[420, top - 20], [1500, top - 18]], reveal(time, 0.3, 0.9), 3);
  ctx.globalAlpha = 1;
  scenes.forEach((scene, index) => {
    withAlpha(ctx, reveal(time, 0.42 + index * 0.12), () => {
      const y = top + index * rowGap;
      ctx.textAlign = "left";
      ctx.font = `500 24px ${fonts.mono}`;
      ctx.fillStyle = colors.accent;
      ctx.fillText(String(index + 1).padStart(2, "0"), 440, y + 8);
      ctx.font = `600 34px ${fonts.display}`;
      ctx.fillStyle = colors.ink;
      ctx.fillText(wrap(ctx, scene.title, 820, 1)[0] ?? scene.title, 520, y);
      ctx.textAlign = "right";
      ctx.font = `500 24px ${fonts.mono}`;
      ctx.fillStyle = colors.mute;
      ctx.fillText(`${scene.seconds.toFixed(0)}s`, 1480, y + 8);
    });
  });

  const label = stage === "writing" ? "Drawing the scenes" : "Checking every scene";
  const dots = ".".repeat(1 + (Math.floor(time * 2.4) % 3));
  withAlpha(ctx, reveal(time, 1.1), () => {
    ctx.textAlign = "center";
    ctx.font = `500 26px ${fonts.mono}`;
    ctx.fillStyle = colors.mute;
    ctx.fillText(`${label}${dots}`, FRAME_WIDTH / 2, FRAME_HEIGHT - 110);
  });
}

export function paintHold(
  ctx: CanvasRenderingContext2D,
  fonts: FontSet,
  time: number,
  hold: { writing: boolean; topic: string },
) {
  const colors = APP_COLORS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textBaseline = "top";
  paintPaper(ctx, colors);

  const cx = FRAME_WIDTH / 2;
  const spin = hold.writing ? time * 1.4 : time * 0.25;
  ctx.save();
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.75;
  const ring: Array<[number, number]> = [];
  for (let k = 0; k <= 40; k += 1) {
    const a = spin + (k / 40) * Math.PI * 1.7;
    ring.push([cx + Math.cos(a) * 70, 300 + Math.sin(a) * 70]);
  }
  handLine(ctx, ring, 1, 11);
  ctx.fillStyle = colors.ink;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, 300, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  kicker(ctx, fonts, hold.writing ? "One moment" : "SeeThrough", cx, 430, colors.accent);
  ctx.font = `600 78px ${fonts.display}`;
  ctx.fillStyle = colors.ink;
  ctx.textAlign = "center";
  const title = hold.writing ? "Planning the outline" : "Video explainer";
  const titleLines = wrap(ctx, title, 1500, 2);
  titleLines.forEach((line, k) => ctx.fillText(line, cx, 490 + k * 92));
  ctx.font = `400 32px ${fonts.sans}`;
  ctx.fillStyle = colors.mute;
  const line = hold.writing
    ? hold.topic.trim() || "Choosing the five scenes."
    : "Type an idea. Get a visual explanation worth sharing.";
  const below = 490 + titleLines.length * 92 + 30;
  wrap(ctx, line, 1200, 2).forEach((text, k) => ctx.fillText(text, cx, below + k * 46));
}
