import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SKIP = new Set([
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

export type PageTheme = {
  css: string;
  colors: Record<string, string>;
  fonts: { sans: string; display: string; mono: string };
  fontHref: string;
};

const DEFAULT_FONTS = {
  sans: '"Source Sans 3", ui-sans-serif, system-ui, sans-serif',
  display: "Fraunces, Georgia, serif",
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

function stripTailwindDirectives(css: string): string {
  return css
    .replace(/@import\s+["']tailwindcss["']\s*;?/g, "")
    .replace(/@theme\b[^{]*\{[\s\S]*?\n\}/g, "")
    .replace(/@source\b[^;]*;/g, "")
    .trim();
}

function colorsFromCss(css: string): Record<string, string> {
  const colors: Record<string, string> = {};
  const root = css.match(/:root\s*\{([\s\S]*?)\}/);
  const block = root?.[1] ?? css;
  for (const match of block.matchAll(/--(?:color-)?([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = match[1]!.replace(/^color-/, "");
    const value = match[2]!.trim();
    if (value.startsWith("var(")) continue;
    if (!/^#|^rgb|^hsl|^[a-z]+$/i.test(value)) continue;
    colors[name] = value;
  }
  return colors;
}

function fontHrefFor(css: string): string {
  const families = new Set<string>(["Source+Sans+3:wght@400;500;600", "Fraunces:opsz,wght@9..144,520", "IBM+Plex+Mono:wght@400;500"]);
  if (/inter/i.test(css)) families.add("Inter:wght@400;500;600");
  if (/geist/i.test(css)) families.add("Geist:wght@400;500;600");
  return `https://fonts.googleapis.com/css2?${[...families].map((f) => `family=${f}`).join("&")}&display=swap`;
}

async function collectCssFiles(root: string, rel: string, depth: number, out: string[]) {
  if (depth > 5 || out.length > 20) return;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (/^(app|src|styles|css)$/i.test(entry.name) || depth === 0) {
        await collectCssFiles(root, next, depth + 1, out);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.css$/i.test(entry.name)) continue;
    if (/node_modules|\.next/.test(next)) continue;
    out.push(next);
  }
}

export async function loadPageTheme(appRoot: string): Promise<PageTheme> {
  const files: string[] = [];
  await collectCssFiles(appRoot, "", 0, files);
  const preferred = files.sort((a, b) => {
    const score = (file: string) => {
      if (/globals\.css$/i.test(file)) return 0;
      if (/index\.css$/i.test(file)) return 1;
      if (/app\.css$/i.test(file)) return 2;
      return 8;
    };
    return score(a) - score(b);
  });

  const chunks: string[] = [];
  const colors: Record<string, string> = {};
  for (const file of preferred.slice(0, 8)) {
    let raw = "";
    try {
      raw = await readFile(path.join(appRoot, file), "utf8");
    } catch {
      continue;
    }
    Object.assign(colors, colorsFromCss(raw));
    const cleaned = stripTailwindDirectives(raw);
    if (cleaned) chunks.push(cleaned);
  }

  return {
    css: chunks.join("\n\n"),
    colors,
    fonts: DEFAULT_FONTS,
    fontHref: fontHrefFor(chunks.join("\n")),
  };
}

export function pageDocument(input: {
  title: string;
  body: string;
  theme: PageTheme;
  bodyClass: string;
  inspect?: boolean;
  islandKeys?: string[];
}): string {
  const colorEntries = Object.entries(input.theme.colors)
    .map(([name, value]) => `        ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
    .join(",\n");
  const extra = Object.entries(input.theme.colors)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${input.theme.fontHref}" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
${colorEntries || '            ink: "#14202e"'}
          },
          fontFamily: {
            sans: ['Source Sans 3', 'ui-sans-serif', 'system-ui', 'sans-serif'],
            display: ['Fraunces', 'Georgia', 'serif'],
            mono: ['IBM Plex Mono', 'ui-monospace', 'monospace']
          }
        }
      }
    };
  </script>
  <style>
    :root {
      --font-source: "Source Sans 3", ui-sans-serif, system-ui, sans-serif;
      --font-fraunces: Fraunces, Georgia, serif;
      --font-plex: "IBM Plex Mono", ui-monospace, monospace;
${extra}
    }
    html, body {
      height: 100%;
      min-height: 100%;
    }
    body {
      margin: 0;
      display: flex;
      flex-direction: column;
      background: var(--bond, #f4f4f6);
      color: var(--ink, #16161a);
      font-family: var(--font-source);
    }
    body > * { flex: 1 1 auto; }
    .st-live-island { flex: 1 1 auto; min-height: 100%; }
    .font-display { font-family: var(--font-fraunces); font-weight: 520; }
    .max-w-136 { max-width: 34rem; }
    ${input.theme.css}
    ${
      input.inspect
        ? `[data-st-id]{cursor:pointer;}
    [data-st-id]:hover{outline:2px solid #6d5efc;outline-offset:2px;}
    [data-st-id].st-on{outline:2px solid #5b4fd4;outline-offset:3px;box-shadow:0 0 0 4px rgba(91,79,212,0.18);}`
        : ""
    }
  </style>
</head>
<body class="${escapeAttr(input.bodyClass)}">
${input.body}
${
  input.inspect
    ? `<script>
(function(){
  function pick(id){
    document.querySelectorAll("[data-st-id].st-on").forEach(function(n){n.classList.remove("st-on");});
    if(!id) return;
    var el=document.querySelector('[data-st-id="'+id+'"]');
    if(el){ el.classList.add("st-on"); el.scrollIntoView({block:"nearest",inline:"nearest"}); }
  }
  document.addEventListener("click", function(event){
    var el=event.target && event.target.closest && event.target.closest("[data-st-id]");
    if(!el) return;
    event.preventDefault();
    event.stopPropagation();
    pick(el.getAttribute("data-st-id"));
    parent.postMessage({type:"seethrough-inspect",id:el.getAttribute("data-st-id")}, "*");
  }, true);
  window.addEventListener("message", function(event){
    if(event.data && event.data.type==="seethrough-select") pick(event.data.id);
  });
})();
</script>`
    : ""
}
${
  input.islandKeys?.length
    ? input.islandKeys
        .map(
          (key) =>
            `<script src="/api/vibe-coder/pages/island?key=${encodeURIComponent(key)}"></script>`,
        )
        .join("\n")
    : ""
}
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
