"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceOrbState } from "@/components/voice-tutor/VoiceOrb";

/*
 * The tutor's voice orb: an always-moving dotted sphere.
 *
 * - Docked, it is the mic button and its dots react to the voice state.
 * - While the tutor thinks, lights race over the dots and a label cycles.
 * - While a lesson (text or whiteboard) loads, it flies up to the loading
 *   spot (`[data-orb-target]`, rendered by LessonSkeleton), grows and loads
 *   there; when the lesson is ready it lights up and flies back home.
 */

const LABELS = ["Thinking", "Searching", "Analyzing", "Composing"];
const DONE = "Done";
const READY = "Ready";

/* ── geometry (CSS px) ── */
const CANVAS = 260; // drawing surface, overflows the 104px dock footprint
const ORB_R = 30; // docked sphere radius
const STAGE_SIZE = 2.4; // sphere scale at the loading spot
const C0 = CANVAS / 2;
const TAU = Math.PI * 2;
/** Keep the thinking look up at least this long so it never flashes. */
const MIN_THINK_MS = 700;
/** Keep the orb at the loading spot at least this long. */
const MIN_STAGE_MS = 900;

/* ── easing ── */
type Ease = (t: number) => number;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const bez = (t: number, p0: number, c: number, p2: number) =>
  (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * c + t * t * p2;

function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const e = sx(t);
      if (Math.abs(e - x) < 1e-6) break;
      if (x > e) lo = t; else hi = t;
      t = (hi + lo) / 2;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

const E = {
  out: cubicBezier(0.22, 1, 0.36, 1),
  io: cubicBezier(0.65, 0, 0.35, 1),
  in: cubicBezier(0.4, 0, 1, 1),
  fly: cubicBezier(0.5, 0, 0.1, 1),
  grow: cubicBezier(0.3, 0, 0.2, 1),
  spring: cubicBezier(0.34, 1.4, 0.64, 1),
};

/* ── timeline channels ── */
type Ch = "u" | "size" | "sweep" | "pop" | "pulse" | "label" | "floor";
type Track = { ch: Ch; from?: number; to: number; t0: number; t1: number; ease?: Ease };
/** `from` omitted = start from wherever the channel is now. */
const T = (ch: Ch, to: number, t0: number, t1: number, ease: Ease = E.io, from?: number): Track =>
  ({ ch, from, to, t0, t1, ease });

const INIT: Record<Ch, number> = { u: 0, size: 1, sweep: 0, pop: 1, pulse: -1, label: 0, floor: 0 };

/** Dock → loading spot. */
const FLY_OUT: Track[] = [
  T("sweep", 0, 0, 200, E.out),
  T("floor", 0, 0, 200, E.out),
  T("label", 0, 0, 140, E.out),
  T("u", 1, 0, 900, E.fly),
  T("size", STAGE_SIZE * 1.06, 0, 720, E.grow),
  T("size", STAGE_SIZE, 720, 900, E.out, STAGE_SIZE * 1.06),
  T("label", 1, 820, 1100, E.out),
];
/** Next loading step while already at the spot. */
const STAY: Track[] = [
  T("sweep", 0, 0, 300, E.out),
  T("floor", 0, 0, 300, E.out),
  T("pop", 1, 0, 300, E.out),
  T("size", STAGE_SIZE, 0, 300, E.out),
  T("label", 1, 0, 300, E.out),
];
/** Loading spot → dock, after the "lit up" moment. */
const FLY_HOME: Track[] = [
  T("label", 0, 0, 160, E.in),
  T("u", 0, 80, 980, E.fly),
  T("size", 1, 80, 900, E.grow),
  T("sweep", 0, 500, 980, E.out),
  T("floor", 0, 500, 980, E.out),
  T("pop", 1.08, 900, 1040, E.out, 1),
  T("pop", 1, 1040, 1300, E.spring, 1.08),
  T("pulse", 1, 920, 1460, E.out, 0),
];
/** Answer landed: dots light up top-to-bottom, a ring pulses out. */
const RESOLVE: Track[] = [
  T("label", 1, 0, 200, E.out),
  T("sweep", 1, 0, 650, E.io, 0),
  T("floor", 0.9, 350, 800, E.out),
  T("pop", 1.06, 520, 700, E.out, 1),
  T("pop", 1, 700, 900, E.spring, 1.06),
  T("pulse", 1, 560, 1100, E.out, 0),
];
const RESOLVE_SETTLE: Track[] = [
  T("label", 0, 0, 260, E.in),
  T("sweep", 0, 100, 700, E.out),
  T("floor", 0, 100, 700, E.out),
];

/* ── dotted sphere data ── */
const DOTS = (() => {
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rings = 14;
  const out: { x: number; y: number; z: number; u: number; s: number }[] = [];
  for (let k = 0; k < rings; k++) {
    const y = 1 - ((k + 0.5) / rings) * 2;
    const r = Math.sqrt(1 - y * y);
    const m = Math.max(4, Math.round(26 * r));
    for (let j = 0; j < m; j++) {
      const a = (j / m) * TAU + k * 0.35;
      out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, u: (1 - y) / 2, s: rand() * TAU });
    }
  }
  return out;
})();
const N = DOTS.length;

/* palette rows: ink (#3f3f46) → brand blue (#1b6ca8); last row is error red */
const G_STEPS = 20, A_STEPS = 40;
const ROW = A_STEPS + 1;
const COLORS: string[] = (() => {
  const out: string[] = [];
  const push = (r: number, g: number, b: number) => {
    for (let ai = 0; ai <= A_STEPS; ai++) out.push(`rgba(${r},${g},${b},${(ai / A_STEPS).toFixed(3)})`);
  };
  for (let gi = 0; gi <= G_STEPS; gi++) {
    const g = gi / G_STEPS;
    push(Math.round(lerp(63, 27, g)), Math.round(lerp(63, 108, g)), Math.round(lerp(70, 168, g)));
  }
  push(194, 69, 69);
  return out;
})();
const RED_ROW = G_STEPS + 1;

/* ── ambient look per voice state (eased toward every frame) ── */
type Look = { spin: number; gain: number; dim: number; blue: number; beat: number; beatHz: number };
const LOOK: Record<VoiceOrbState | "loading", Look> = {
  idle: { spin: 0.25, gain: 0.35, dim: 0.7, blue: 0, beat: 0, beatHz: 0 },
  connecting: { spin: 0.5, gain: 0.6, dim: 0.8, blue: 0.4, beat: 0.02, beatHz: 1.6 },
  wake: { spin: 0.35, gain: 0.55, dim: 0.9, blue: 0.6, beat: 0.02, beatHz: 0.9 },
  listening: { spin: 0.4, gain: 0.7, dim: 1, blue: 0.85, beat: 0.03, beatHz: 1 },
  thinking: { spin: 0.95, gain: 1, dim: 1, blue: 0.35, beat: 0, beatHz: 0 },
  speaking: { spin: 0.55, gain: 0.85, dim: 1, blue: 1, beat: 0.055, beatHz: 2.3 },
  error: { spin: 0.15, gain: 0.3, dim: 0.85, blue: 0, beat: 0, beatHz: 0 },
  loading: { spin: 0.95, gain: 1, dim: 1, blue: 0.35, beat: 0, beatHz: 0 },
};

type Props = {
  state: VoiceOrbState;
  className?: string;
  /** When set, the orb is the mic button. */
  onPress?: () => void;
  micOn?: boolean;
  pressLabel?: string;
  /** Lesson is loading: fly to the loading spot and show this label. */
  loadingLabel?: string | null;
};

type Inputs = { state: VoiceOrbState; loading: string | null };

export function MorphOrb({ state, className, onPress, micOn = false, pressLabel, loadingLabel = null }: Props) {
  const homeRef = useRef<HTMLDivElement>(null);
  const moverRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const pulseRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const [label, setLabel] = useState<{ cur: string; prev: string | null; n: number }>({
    cur: LABELS[0],
    prev: null,
    n: 0,
  });

  const engineRef = useRef<{ update(i: Inputs): void } | null>(null);

  useEffect(() => {
    const home = homeRef.current, mover = moverRef.current, canvas = canvasRef.current;
    const glow = glowRef.current, pulse = pulseRef.current, labelEl = labelRef.current, icon = iconRef.current;
    if (!home || !mover || !canvas || !glow || !pulse || !labelEl || !icon) return;
    const ctx = canvas.getContext("2d");
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = () => mq.matches;

    const V: Record<Ch, number> = { ...INIT };
    const A = { ...LOOK.idle, red: 0, icon: 1 }; // eased ambient values
    let look: Look = LOOK.idle;
    let red = 0;
    let showIcon = true;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(CANVAS * dpr);
    canvas.height = Math.round(CANVAS * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* ── flight path ── */
    let dir = 1;
    let target = { x: 0, y: 0 };
    const findTarget = () => {
      const h = home.getBoundingClientRect();
      const hx = h.left + h.width / 2, hy = h.top + h.height / 2;
      const spots = Array.from(document.querySelectorAll<HTMLElement>("[data-orb-target]"));
      const spot = spots.find((el) => el.getClientRects().length > 0);
      if (spot) {
        const r = spot.getBoundingClientRect();
        target = { x: r.left + r.width / 2 - hx, y: r.top + r.height / 2 - hy };
      } else if (V.u < 0.001) {
        target = { x: window.innerWidth / 2 - hx, y: window.innerHeight * 0.42 - hy };
      }
      // else: keep the last spot so the orb doesn't jump while it leaves
    };

    /* ── sphere renderer ── */
    const lit = new Float32Array(N);
    const SX = new Float32Array(N), SY = new Float32Array(N), SR = new Float32Array(N), SD = new Float32Array(N);
    const SC = new Int16Array(N);
    const pw = [1, 0, 0, 0];
    let prog = 0, rot = 0, time = 0, last = 0, raf = 0, dead = false;
    const CP = Math.cos(0.35), SP = Math.sin(0.35);

    const draw = (dt: number) => {
      if (!ctx) return;
      ctx.clearRect(0, 0, CANVAS, CANVAS);
      time += dt;
      rot += A.spin * dt;
      const cyw = Math.cos(rot), syw = Math.sin(rot);
      const stepW = dt / 0.35;
      for (let q = 0; q < 4; q++) {
        const d = (q === prog ? 1 : 0) - pw[q];
        pw[q] += Math.abs(d) <= stepW ? d : d > 0 ? stepW : -stepW;
      }
      const decay = Math.exp(-dt / 0.5);
      const h0 = (time * 240) % N, h3 = (time * 380) % N;
      const a1 = time * 0.8, b1 = Math.sin(time * 0.5) * 0.9;
      const f1x = Math.cos(b1) * Math.cos(a1), f1y = Math.sin(b1), f1z = Math.cos(b1) * Math.sin(a1);
      const a2 = time * 0.55 + 2.1, b2 = Math.cos(time * 0.42) * 0.9;
      const f2x = Math.cos(b2) * Math.cos(a2), f2y = Math.sin(b2), f2z = Math.cos(b2) * Math.sin(a2);
      const lat = Math.sin(time * 2.2);
      const beat = 1 + A.beat * (0.5 + 0.5 * Math.sin(time * TAU * (A.beatHz || 1)));
      const R = ORB_R * V.size * V.pop * beat;
      const dotK = 0.55 + 0.45 * V.size; // dots grow a little with the sphere

      for (let n = 0; n < N; n++) {
        const { x: dx, y: dy, z: dz, u, s } = DOTS[n];
        let p = 0;
        if (pw[0] > 0.001) {
          let dd = Math.abs(n - h0); if (dd > N - dd) dd = N - dd;
          const v = Math.max(0, 1 - dd / 12); p = Math.max(p, v * v * pw[0]);
        }
        if (pw[1] > 0.001) {
          const v = Math.max(
            0,
            (dx * f1x + dy * f1y + dz * f1z - 0.72) / 0.28,
            (dx * f2x + dy * f2y + dz * f2z - 0.72) / 0.28,
          );
          p = Math.max(p, v * v * pw[1]);
        }
        if (pw[2] > 0.001) {
          const e = dy - lat; const v = Math.max(0, 1 - (e * e) / 0.02); p = Math.max(p, v * v * pw[2]);
        }
        if (pw[3] > 0.001) {
          let dd = Math.abs(n - h3); if (dd > N - dd) dd = N - dd;
          const v = Math.max(0, 1 - dd / 16); p = Math.max(p, v * v * pw[3]);
        }
        const l = Math.max(lit[n] * decay, p * A.gain);
        lit[n] = l;

        const x1 = dx * cyw + dz * syw, z1 = -dx * syw + dz * cyw;
        const y2 = dy * CP - z1 * SP, z2 = dy * SP + z1 * CP;
        const f = 2.8 / (2.8 - z2), depth = (z2 + 1) / 2;

        const g = clamp01((V.sweep * 1.4 - u) / 0.4);
        let a = 0.14 + 0.04 * Math.sin(s + time * 1.6) * (1 - g) + 0.36 * depth * depth + 0.7 * l * (1 - g) +
          g * (0.55 + 0.4 * depth) + 2 * g * (1 - g);
        a = Math.max(a, V.floor * (0.7 + 0.3 * depth));
        if (a > 1) a = 1;
        a *= A.dim;

        SX[n] = C0 + x1 * R * f;
        SY[n] = C0 - y2 * R * f;
        SD[n] = depth;
        SR[n] = (0.8 * (0.45 + 0.75 * depth) * f + 0.6 * l + g * 0.2) * dotK * (1 + 0.15 * V.floor);
        const ai = Math.round(a * A_STEPS);
        const tint = Math.max(g, l * A.blue * (1 - g));
        const row = A.red > 0.5 && g < 0.01 ? RED_ROW : Math.round(tint * G_STEPS);
        SC[n] = ai <= 0 ? -1 : row * ROW + ai;
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let n = 0; n < N; n++) {
          const c = SC[n];
          if (c < 0 || (SD[n] >= 0.5) !== (pass === 1)) continue;
          ctx.fillStyle = COLORS[c];
          ctx.beginPath();
          ctx.arc(SX[n], SY[n], SR[n], 0, TAU);
          ctx.fill();
        }
      }
    };

    /* ── DOM writes, once per frame ── */
    const apply = () => {
      if (V.u > 0.001) {
        findTarget(); // track layout shifts while away from home
        const H = Math.abs(target.y) || 1;
        const x = bez(V.u, 0, target.x * 0.5 + dir * 0.3 * H, target.x);
        const y = bez(V.u, 0, target.y * 0.4, target.y);
        mover.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
      } else {
        mover.style.transform = "";
      }
      const sz = V.size * V.pop;
      glow.style.transform = `scale(${sz.toFixed(3)})`;
      icon.style.opacity = A.icon.toFixed(3);
      // label sits above the docked orb and below it at the loading spot
      const below = V.u > 0.5;
      const gap = ORB_R * sz * 1.1 + 18;
      const lift = (1 - V.label) * 6;
      labelEl.style.opacity = V.label.toFixed(3);
      labelEl.style.transform = `translate(-50%, -50%) translateY(${(below ? gap + lift : -gap + lift).toFixed(2)}px)`;
      if (V.pulse < 0) pulse.style.opacity = "0";
      else {
        pulse.style.opacity = (0.45 * (1 - V.pulse)).toFixed(3);
        pulse.style.transform = `scale(${(sz * (1 + V.pulse * 0.9)).toFixed(3)})`;
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (dead) return;
      const real = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const dt = reduced() ? 0 : real;
      const k = 1 - Math.exp(-real / 0.35);
      A.spin = lerp(A.spin, reduced() ? 0 : look.spin, k);
      A.gain = lerp(A.gain, look.gain, k);
      A.dim = lerp(A.dim, look.dim, k);
      A.blue = lerp(A.blue, look.blue, k);
      A.beat = lerp(A.beat, reduced() ? 0 : look.beat, k);
      A.beatHz = look.beatHz || A.beatHz;
      A.red = lerp(A.red, red, k);
      A.icon = lerp(A.icon, showIcon ? 1 : 0, 1 - Math.exp(-real / 0.15));
      draw(dt);
      apply();
      raf = requestAnimationFrame(frame);
    };
    last = performance.now();
    raf = requestAnimationFrame(frame);

    /* ── timeline player: newest call wins ── */
    let gen = 0;
    const play = (tracks: Track[], my: number) =>
      new Promise<boolean>((res) => {
        const end = tracks.reduce((m, t) => Math.max(m, t.t1), 0);
        const speed = reduced() ? 4 : 1;
        const from = new Map<Track, number>();
        let t = 0, prev = performance.now();
        const step = (now: number) => {
          if (dead || my !== gen) { res(false); return; }
          t += Math.min(100, now - prev) * speed;
          prev = now;
          for (const k of tracks) {
            if (t < k.t0) continue;
            if (!from.has(k)) from.set(k, k.from ?? V[k.ch]);
            const p = clamp01((t - k.t0) / Math.max(1, k.t1 - k.t0));
            V[k.ch] = lerp(from.get(k)!, k.to, (k.ease ?? E.io)(p));
          }
          if (t >= end) res(true);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, Math.max(0, ms)));

    /* ── labels ── */
    let labelTimer = 0;
    const stopLabels = () => window.clearInterval(labelTimer);
    const swap = (name: string) =>
      setLabel((l) => (l.cur === name ? l : { cur: name, prev: l.cur, n: l.n + 1 }));
    const startThinkingLabels = () => {
      stopLabels();
      setLabel((l) => ({ cur: LABELS[0], prev: null, n: l.n + 1 }));
      let i = 0;
      prog = 0;
      labelTimer = window.setInterval(() => {
        i = (i + 1) % LABELS.length;
        prog = i % 4;
        swap(LABELS[i]);
      }, 1150);
    };

    /* ── director ── */
    let away = false; // at the loading spot, or flying to / from it
    let awaySince = 0;
    let thinking = false;
    let thinkSince = 0;
    let loadingText: string | null = null;
    let voice: VoiceOrbState = "idle";

    const refreshLook = () => {
      look = loadingText ? LOOK.loading : LOOK[voice];
      red = voice === "error" ? 1 : 0;
      showIcon = !away && !thinking && !loadingText;
    };

    const update = async ({ state: s, loading }: Inputs) => {
      const wasThinking = thinking;
      const wasLoading = loadingText !== null;
      voice = s;
      thinking = s === "thinking";
      loadingText = loading ? loading.replace(/[.…\s]+$/, "") : null;
      refreshLook();

      /* lesson loading: go to the loading spot and load there */
      if (loadingText) {
        stopLabels();
        prog = 1;
        if (!wasLoading) setLabel((l) => ({ cur: loadingText!, prev: null, n: l.n + 1 }));
        else swap(loadingText);
        const my = ++gen; // also cancels a pending "ready → fly home"
        if (away && V.u > 0.999) {
          // already at the spot (e.g. text plan done, whiteboard next): stay
          await play(STAY, my);
          return;
        }
        if (!away) {
          away = true;
          awaySince = performance.now();
          dir = -dir;
        }
        refreshLook();
        await play(FLY_OUT, my);
        return;
      }

      /* lesson ready: light up at the spot, then fly home */
      if (wasLoading && away) {
        const my = ++gen;
        await sleep(MIN_STAGE_MS - (performance.now() - awaySince));
        if (my !== gen) return;
        swap(READY);
        if (!(await play(RESOLVE, my))) return;
        if (!(await play(FLY_HOME, my))) return;
        away = false;
        V.pulse = -1;
        refreshLook();
        if (thinking) {
          thinkSince = performance.now();
          startThinkingLabels();
          void play([T("label", 1, 0, 300, E.out)], ++gen);
        } else prog = 0;
        return;
      }
      if (away) return; // flying home; picks the state up when it lands

      /* docked thinking */
      if (thinking && !wasThinking) {
        const my = ++gen;
        thinkSince = performance.now();
        startThinkingLabels();
        await play([T("sweep", 0, 0, 200, E.out), T("floor", 0, 0, 200, E.out), T("label", 1, 0, 320, E.out)], my);
        return;
      }
      if (!thinking && wasThinking) {
        const my = ++gen;
        await sleep(MIN_THINK_MS - (performance.now() - thinkSince));
        if (my !== gen) return;
        stopLabels();
        prog = 0;
        swap(DONE);
        if (!(await play(RESOLVE, my))) return;
        await play(RESOLVE_SETTLE, my);
      }
    };

    engineRef.current = { update: (i) => void update(i) };
    return () => {
      dead = true;
      gen++;
      stopLabels();
      if (raf) cancelAnimationFrame(raf);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.update({ state, loading: loadingLabel });
  }, [state, loadingLabel]);

  const Root = onPress ? "button" : "div";
  const busyLabel = loadingLabel ?? (state === "thinking" ? "Thinking" : "");

  return (
    <div ref={homeRef} className={cn("relative size-[104px]", className)}>
      <span className="sr-only" aria-live="polite">{busyLabel}</span>
      <div ref={moverRef} className="absolute inset-0 will-change-transform">
        {/* soft glow behind the dots */}
        <span
          ref={glowRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 left-1/2 -mt-8 -ml-8 size-16 rounded-full blur-xl transition-[background-color] duration-500",
            state === "speaking" && "bg-[#1b6ca8]/25",
            (state === "listening" || state === "wake") && "bg-[#5aa8ef]/25",
            (state === "thinking" || loadingLabel) && "bg-[#1b6ca8]/12",
            state === "error" && "bg-[#c24545]/20",
            (state === "idle" || state === "connecting") && !loadingLabel && "bg-[#1b6ca8]/10",
          )}
        />
        {/* ring that pulses out when an answer lands */}
        <span
          ref={pulseRef}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 -mt-[30px] -ml-[30px] size-[60px] rounded-full border-2 border-[#1b6ca8] opacity-0"
        />
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 -mt-[130px] -ml-[130px] size-[260px]"
        />
        <Root
          {...(onPress
            ? {
                type: "button" as const,
                onClick: onPress,
                "aria-pressed": micOn,
                "aria-label": pressLabel ?? (micOn ? "Turn microphone off" : "Turn microphone on"),
                title: pressLabel ?? (micOn ? "Tap to mute" : "Tap to talk"),
              }
            : { role: "img", "aria-label": busyLabel || state })}
          className={cn(
            "group absolute top-1/2 left-1/2 -mt-[38px] -ml-[38px] grid size-[76px] place-items-center rounded-full outline-none",
            onPress &&
              "cursor-pointer touch-manipulation transition-transform hover:bg-[#1b6ca8]/[0.04] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#1b6ca8]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f4f6] motion-reduce:active:scale-100",
          )}
        >
          <span ref={iconRef} aria-hidden className="pointer-events-none grid place-items-center">
            {onPress ? (
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full bg-white/85 text-[#1b6ca8] shadow-sm transition-opacity duration-300",
                  micOn ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : "opacity-100",
                )}
              >
                {micOn ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
              </span>
            ) : null}
          </span>
        </Root>
        {/* status label: above when docked, below at the loading spot */}
        <div
          ref={labelRef}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 inline-grid rounded-full bg-white/90 px-3 py-1 opacity-0 shadow-sm"
        >
          {label.prev !== null ? (
            <span key={`p${label.n}`} className="morph-orb-label morph-orb-label-out">
              {labelInner(label.prev)}
            </span>
          ) : null}
          <span key={`c${label.n}`} className="morph-orb-label morph-orb-label-in">
            {labelInner(label.cur)}
          </span>
        </div>
      </div>
    </div>
  );
}

function labelInner(name: string) {
  if (name === DONE || name === READY) {
    return <span className="font-semibold text-[#1b6ca8]">{name}</span>;
  }
  return (
    <>
      <span>{name}</span>
      <span className="morph-orb-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </>
  );
}
