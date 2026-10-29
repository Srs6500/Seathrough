import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  InspectButtonStyle,
  InspectFontRole,
  InspectOverview,
  InspectSwatch,
  InspectTarget,
} from "@/lib/vibe-coder/inspectTypes";

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "vendor",
  "out",
]);

const TW_HEX: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  "gray-200": "#e5e7eb",
  "gray-300": "#d1d5db",
  "gray-400": "#9ca3af",
  "gray-500": "#6b7280",
  "zinc-400": "#a1a1aa",
  "zinc-500": "#71717a",
  "slate-400": "#94a3b8",
};

const GOOGLE_FONT: Record<string, string> = {
  geist: "Geist",
  geist_mono: "Geist Mono",
  geistmono: "Geist Mono",
  inter: "Inter",
  fraunces: "Fraunces",
  roboto: "Roboto",
  "source_sans_3": "Source Sans 3",
  sourcesans3: "Source Sans 3",
  "ibm_plex_mono": "IBM Plex Mono",
  ibmplexmono: "IBM Plex Mono",
  merriweather: "Merriweather",
  playfair_display: "Playfair Display",
  space_grotesk: "Space Grotesk",
};

function prettyFamily(raw: string): string {
  const cleaned = raw
    .replace(/["']/g, "")
    .split(",")[0]
    ?.replace(/var\(--font-([^)]+)\)/, "$1")
    .replace(/^font-/, "")
    .replace(/-/g, " ")
    .trim();
  if (!cleaned) return "System UI";
  const key = cleaned.toLowerCase().replace(/\s+/g, "_");
  if (GOOGLE_FONT[key]) return GOOGLE_FONT[key];
  if (/geist/.test(cleaned) && /mono/i.test(cleaned)) return "Geist Mono";
  if (/geist/.test(cleaned)) return "Geist";
  return cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function parseHex(value: string): string | null {
  const hex = value.trim();
  const match = hex.match(/^#([0-9a-f]{3,8})$/i);
  if (!match) return null;
  let body = match[1]!;
  if (body.length === 3) {
    body = body
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (body.length === 8) body = body.slice(0, 6);
  if (body.length !== 6) return null;
  return `#${body.toLowerCase()}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function colorToHex(value: string): string | null {
  const hex = parseHex(value);
  if (hex) return hex;
  const rgb = value.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const hsl = value.trim().match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hsl) {
    const h = Number(hsl[1]) / 360;
    const s = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  return null;
}

function withAlpha(hex: string, alpha: number): string {
  const body = hex.replace("#", "");
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function twColor(token: string): string | null {
  const [name, alpha] = token.split("/");
  if (!name) return null;
  const base = TW_HEX[name] ?? parseHex(name.startsWith("[#") ? name.slice(1, -1) : "") ?? null;
  if (!base) {
    const arb = name.match(/^\[(#(?:[0-9a-f]{3,8}))\]$/i);
    if (arb?.[1]) {
      const hex = parseHex(arb[1]);
      if (!hex) return null;
      return alpha ? withAlpha(hex, Number(alpha) / 100) : hex;
    }
    return null;
  }
  if (!alpha) return base;
  const pct = Number(alpha);
  if (!Number.isFinite(pct)) return base;
  return withAlpha(base, pct / 100);
}

async function collectFiles(
  root: string,
  rel: string,
  depth: number,
  out: string[],
  match: (name: string) => boolean,
) {
  if (depth > 4 || out.length > 40) return;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR.has(entry.name) || entry.name.startsWith(".")) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (/^(app|src|styles|css|components)$/i.test(entry.name) || depth === 0) {
        await collectFiles(root, next, depth + 1, out, match);
      }
      continue;
    }
    if (entry.isFile() && match(entry.name)) out.push(next);
  }
}

function fontsFromLayout(text: string): Array<{ family: string; kind: "sans" | "mono" | "display" }> {
  const found: Array<{ family: string; kind: "sans" | "mono" | "display" }> = [];
  const importMatch = text.match(/import\s+\{([^}]+)\}\s+from\s+["']next\/font\/google["']/);
  if (importMatch?.[1]) {
    for (const raw of importMatch[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0]?.trim();
      if (!name) continue;
      const family = prettyFamily(name);
      const kind = /mono/i.test(family) ? "mono" : /display|serif|fraunces|playfair|merriweather/i.test(family) ? "display" : "sans";
      found.push({ family, kind });
    }
  }
  for (const match of text.matchAll(/localFont\s*\(\s*\{[\s\S]*?variable:\s*["']--font-([^"']+)["']/g)) {
    const family = prettyFamily(match[1] ?? "sans");
    const kind = /mono/i.test(family) ? "mono" : /display|serif/i.test(family) ? "display" : "sans";
    found.push({ family, kind });
  }
  return found;
}

function fontsFromCss(css: string): Array<{ family: string; kind: "sans" | "mono" | "display" }> {
  const found: Array<{ family: string; kind: "sans" | "mono" | "display" }> = [];
  const pairs: Array<[RegExp, "sans" | "mono" | "display"]> = [
    [/--font-sans\s*:\s*([^;]+);/i, "sans"],
    [/--font-display\s*:\s*([^;]+);/i, "display"],
    [/--font-mono\s*:\s*([^;]+);/i, "mono"],
    [/font-family\s*:\s*([^;]+);/i, "sans"],
  ];
  for (const [re, kind] of pairs) {
    const match = css.match(re);
    if (!match?.[1]) continue;
    const family = prettyFamily(match[1]);
    if (/^(sans|serif|mono|display)$/i.test(family)) continue;
    if (/system-ui|sans-serif|serif|monospace/i.test(family) && !/geist|inter|fraunces|source|plex|roboto/i.test(family)) {
      continue;
    }
    found.push({ family, kind });
  }
  return found;
}

const TW_PX: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
};

function pxFromClass(className: string): number[] {
  const sizes: number[] = [];
  for (const cls of className.split(/\s+/)) {
    const base = cls.replace(/^(?:[\w-]+:)+/, "");
    const arb = base.match(/^text-\[(\d+(?:\.\d+)?)px\]$/);
    if (arb) {
      sizes.push(Number(arb[1]));
      continue;
    }
    const named = base.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)$/);
    if (named?.[1] && TW_PX[named[1]]) sizes.push(TW_PX[named[1]]!);
  }
  return [...new Set(sizes)].sort((a, b) => a - b);
}

function formatPx(sizes: number[], fallback: number): string {
  const unique = [...new Set(sizes)].sort((a, b) => a - b);
  if (!unique.length) return `${fallback}px`;
  if (unique.length === 1) return `${unique[0]}px`;
  return `${unique[0]} / ${unique[unique.length - 1]}px`;
}

function headingSpec(targets: InspectTarget[]): { weight: string; size: string } {
  const heading = targets.find((target) => target.kind === "heading") ?? targets.find((t) => /^h[1-3]$/i.test(t.tag));
  const cls = heading?.className ?? "";
  const weight = /\bfont-(semibold|bold|medium|extrabold)\b/.exec(cls)?.[1] ?? "semibold";
  return { weight, size: formatPx(pxFromClass(cls), 30) };
}

function bodySpec(targets: InspectTarget[]): { weight: string; size: string } {
  const counts = new Map<string, number>();
  for (const target of targets) {
    if (target.kind === "heading") continue;
    const sizes = pxFromClass(target.className).filter((px) => px >= 14 && px <= 20);
    for (const px of sizes) {
      const key = `${px}px`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { weight: "regular", size: best?.[0] ?? "16px" };
}

function labelSpec(targets: InspectTarget[]): { weight: string; size: string } {
  const labels = targets
    .map((target) => target.className)
    .filter((cls) => /\btext-\[13px\]|\btext-xs\b|\btext-sm\b/.test(cls));
  const sizes = labels.flatMap((cls) => pxFromClass(cls)).filter((px) => px <= 14);
  return { weight: "regular", size: formatPx(sizes, 13) };
}

function uniqueFonts(
  rows: Array<{ family: string; kind: "sans" | "mono" | "display" }>,
): Array<{ family: string; kind: "sans" | "mono" | "display" }> {
  const seen = new Set<string>();
  const out: Array<{ family: string; kind: "sans" | "mono" | "display" }> = [];
  for (const row of rows) {
    const key = `${row.kind}:${row.family.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function buildFonts(
  declared: Array<{ family: string; kind: "sans" | "mono" | "display" }>,
  targets: InspectTarget[],
): InspectFontRole[] {
  const sans = declared.find((row) => row.kind === "sans");
  const display = declared.find((row) => row.kind === "display");
  const mono = declared.find((row) => row.kind === "mono");
  const heading = headingSpec(targets);
  const body = bodySpec(targets);
  const label = labelSpec(targets);
  const primaryFamily = sans?.family || display?.family || "System UI";
  const secondaryFamily = display?.family && display.family !== primaryFamily ? display.family : primaryFamily;
  const tertiaryFamily = mono?.family || primaryFamily;
  const fonts: InspectFontRole[] = [
    {
      role: "primary",
      family: primaryFamily,
      weight: body.weight,
      size: body.size,
      usage: "Body copy, navigation, form fields, and most UI.",
      source: sans ? "next/font or CSS --font-sans" : "Inferred from body text",
    },
    {
      role: "secondary",
      family: secondaryFamily,
      weight: heading.weight,
      size: heading.size,
      usage: "Headings and hero titles.",
      source: display ? "Display/serif font" : "Heading classNames on this frontend",
    },
    {
      role: "tertiary",
      family: tertiaryFamily,
      weight: label.weight,
      size: label.size,
      usage: mono ? "Code, mono UI, and technical labels." : "Small supporting labels and captions.",
      source: mono ? "Mono font" : "Small text classes (text-sm / 13px)",
    },
  ];
  return fonts;
}

function addSwatch(
  map: Map<string, { name: string; value: string; usage: string; score: number }>,
  name: string,
  value: string,
  usage: string,
  score: number,
) {
  const hex = colorToHex(value) ?? (/^rgba?\(/i.test(value) ? value : null);
  if (!hex) return;
  const key = hex.toLowerCase();
  const prev = map.get(key);
  if (!prev || score > prev.score) {
    map.set(key, { name, value: hex, usage, score });
    return;
  }
  if (prev && score === prev.score && name.length < prev.name.length) {
    map.set(key, { ...prev, name });
  }
}

function classColors(className: string, into: Map<string, { name: string; value: string; usage: string; score: number }>) {
  for (const raw of className.split(/\s+/)) {
    const cls = raw.replace(/^(?:[\w-]+:)+/, "");
    const arb = cls.match(/^(bg|text|border|ring|from|to)-\[(#(?:[0-9a-f]{3,8}))\](?:\/(\d+))?$/i);
    if (arb) {
      const hex = parseHex(arb[2]!);
      if (!hex) continue;
      const value = arb[3] ? withAlpha(hex, Number(arb[3]) / 100) : hex;
      const usage =
        arb[1] === "bg" || arb[1] === "from" || arb[1] === "to"
          ? "Fill"
          : arb[1] === "text"
            ? "Text"
            : "Accent";
      addSwatch(into, hex, value, usage, arb[1] === "bg" ? 8 : 6);
      continue;
    }
    const tw = cls.match(/^(bg|text|border)-(white|black|gray-\d{2,3}|zinc-\d{2,3}|slate-\d{2,3})(?:\/(\d+))?$/);
    if (tw) {
      const token = tw[3] ? `${tw[2]}/${tw[3]}` : tw[2]!;
      const value = twColor(token);
      if (!value) continue;
      addSwatch(
        into,
        token.replace("/", " "),
        value,
        tw[1] === "bg" ? "Fill" : tw[1] === "text" ? "Text" : "Border",
        3,
      );
    }
  }
}

function cssColors(css: string, into: Map<string, { name: string; value: string; usage: string; score: number }>) {
  for (const match of css.matchAll(/--(?:color-)?([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = match[1]!.replace(/^color-/, "");
    const value = match[2]!.trim();
    const hex = colorToHex(value);
    if (!hex) continue;
    const usage = /background|bg|surface|bond/i.test(name)
      ? "Background"
      : /foreground|ink|text/i.test(name)
        ? "Text"
        : /accent|primary|brand/i.test(name)
          ? "Accent"
          : "Theme";
    addSwatch(into, name, hex, usage, 10);
  }
}

function radiusOf(className: string): string {
  if (/\brounded-full\b/.test(className)) return "pill";
  if (/\brounded-2xl\b/.test(className)) return "16px (2xl)";
  if (/\brounded-xl\b/.test(className)) return "12px (xl)";
  if (/\brounded-lg\b/.test(className)) return "8px (lg)";
  if (/\brounded-md\b/.test(className)) return "6px (md)";
  if (/\brounded\b/.test(className)) return "4px";
  return "square";
}

function paddingOf(className: string): string {
  const icon = /\bw-10\b/.test(className) && /\bh-10\b/.test(className);
  if (icon) return "40×40 icon";
  const x = /\bpx-(\d+(?:\.\d+)?)\b/.exec(className)?.[1];
  const y = /\bpy-(\d+(?:\.\d+)?)\b/.exec(className)?.[1];
  if (x && y) return `px-${x} py-${y}`;
  if (/\bpx-3\b/.test(className)) return "compact chip";
  return "default";
}

function fillOf(className: string): { fill: string; hex: string | null; opaque: boolean } {
  const arb = className.match(/\bbg-\[(#(?:[0-9a-f]{3,8}))\](?:\/(\d+))?/i);
  if (arb) {
    const hex = parseHex(arb[1]!);
    if (hex) {
      return {
        fill: arb[2] ? `${hex} / ${arb[2]}%` : hex,
        hex,
        opaque: !arb[2],
      };
    }
  }
  const tw = className.match(/\bbg-(white|black|gray-\d+|zinc-\d+)(?:\/(\d+))?/);
  if (tw) {
    const token = tw[2] ? `${tw[1]}/${tw[2]}` : tw[1]!;
    return { fill: token, hex: twColor(token), opaque: !tw[2] };
  }
  if (/\bborder\b/.test(className)) return { fill: "outline", hex: null, opaque: false };
  return { fill: "ghost", hex: null, opaque: false };
}

function textOf(className: string): string {
  const arb = className.match(/\btext-\[(#(?:[0-9a-f]{3,8}))\]/i);
  if (arb) return parseHex(arb[1]!) ?? arb[1]!;
  const tw = className.match(/\btext-(white|black|gray-\d+|zinc-\d+)(?:\/(\d+))?/);
  if (tw) return tw[2] ? `${tw[1]} / ${tw[2]}%` : tw[1]!;
  return "inherit";
}

function buttonRole(className: string): "primary" | "secondary" | "tertiary" {
  const fill = fillOf(className);
  if (fill.opaque) return "primary";
  if (fill.fill !== "ghost") return "secondary";
  return "tertiary";
}

function buttonScore(role: "primary" | "secondary" | "tertiary", target: InspectTarget): number {
  const cls = target.className;
  if (/\bfixed\b/.test(cls) || /\blg:hidden\b/.test(cls)) return 0;
  if (role === "primary") {
    if (/\bbg-\[[^\]]+\]/.test(cls)) return 12;
    if (/\bbg-(white|black)\b/.test(cls)) return 10;
    return 4;
  }
  if (role === "secondary") {
    if (/\bpx-3\b/.test(cls) && /\bpy-1/.test(cls)) return 12;
    if (/\bbg-white\/10\b/.test(cls)) return 8;
    return 3;
  }
  if (/\bhover:text-/.test(cls)) return 8;
  if (target.text.trim()) return 6;
  return 2;
}

function buildButtons(targets: InspectTarget[]): InspectButtonStyle[] {
  const buttons = targets.filter((target) => target.kind === "button");
  const grouped = new Map<"primary" | "secondary" | "tertiary", InspectTarget[]>();
  for (const button of buttons) {
    const role = buttonRole(button.className);
    if (!grouped.has(role)) grouped.set(role, []);
    grouped.get(role)!.push(button);
  }
  const roles: Array<"primary" | "secondary" | "tertiary"> = ["primary", "secondary", "tertiary"];
  const out: InspectButtonStyle[] = [];
  for (const role of roles) {
    const list = grouped.get(role);
    if (!list?.length) continue;
    const sample = [...list].sort((a, b) => buttonScore(role, b) - buttonScore(role, a))[0]!;
    const fill = fillOf(sample.className);
    out.push({
      role,
      label:
        role === "primary"
          ? "Solid action"
          : role === "secondary"
            ? "Soft / selected chip"
            : "Ghost text",
      radius: radiusOf(sample.className),
      fill: fill.fill,
      fillCss: fill.hex ?? "transparent",
      text: textOf(sample.className),
      padding: paddingOf(sample.className),
      example: sample.name,
      className: sample.className.split(/\s+/).slice(0, 10).join(" "),
    });
  }
  return out;
}

function summaryOf(fonts: InspectFontRole[], palette: InspectSwatch[], buttons: InspectButtonStyle[]): string {
  const type = fonts
    .map((font) => `${font.role} ${font.family}`)
    .join(", ");
  const colors = palette.slice(0, 4).map((swatch) => swatch.value).join(", ");
  const button = buttons[0]
    ? `Primary buttons are ${buttons[0].radius} with a ${buttons[0].fill} fill.`
    : "No button styles were found.";
  return `Type: ${type}. Palette: ${colors || "not declared"}. ${button}`;
}

export async function buildInspectOverview(input: {
  appRoot: string;
  targets: InspectTarget[];
}): Promise<InspectOverview> {
  const files: string[] = [];
  await collectFiles(input.appRoot, "", 0, files, (name) =>
    /(layout\.(tsx|jsx|js)|globals\.css|index\.css|app\.css|tailwind\.config\.(js|ts|cjs))$/i.test(
      name,
    ),
  );

  let css = "";
  let layout = "";
  for (const rel of files.sort()) {
    let text = "";
    try {
      text = await readFile(path.join(input.appRoot, rel), "utf8");
    } catch {
      continue;
    }
    if (/\.css$/i.test(rel)) css += `\n${text}`;
    else layout += `\n${text}`;
  }

  const declared = uniqueFonts([...fontsFromLayout(layout), ...fontsFromCss(css)]);
  const fonts = buildFonts(declared, input.targets);

  const swatchMap = new Map<string, { name: string; value: string; usage: string; score: number }>();
  cssColors(css, swatchMap);
  for (const target of input.targets) classColors(target.className, swatchMap);
  const palette: InspectSwatch[] = [...swatchMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ name, value, usage }) => ({
      name: name.replace(/-/g, " "),
      value,
      usage,
    }));

  const buttons = buildButtons(input.targets);
  return {
    fonts,
    palette,
    buttons,
    summary: summaryOf(fonts, palette, buttons),
  };
}
