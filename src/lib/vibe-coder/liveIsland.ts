import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export type LiveIsland = {
  id: string;
  file: string;
  exportName: string;
  props: Record<string, unknown>;
  callbacks: string[];
};

const globalKey = "__seethrough_live_islands__";

function store(): Map<string, string> {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, string>;
  };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

export function sourceNeedsLiveRuntime(text: string): boolean {
  return (
    /\bfrom\s+['"]three(?:\/[^'"]*)?['"]/.test(text) ||
    /\brequire\(\s*['"]three['"]/.test(text) ||
    /\bfrom\s+['"]@react-three\//.test(text) ||
    /\bWebGLRenderer\b/.test(text) ||
    /\bgetContext\(\s*['"]webgl/.test(text)
  );
}

export function getLiveIslandScript(key: string): string | null {
  return store().get(key) ?? null;
}

export function liveIslandKey(island: LiveIsland): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        file: island.file,
        exportName: island.exportName,
        props: island.props,
        callbacks: island.callbacks,
        v: 1,
      }),
    )
    .digest("hex")
    .slice(0, 24);
}

function shouldStub(spec: string): boolean {
  return (
    spec === "next" ||
    spec.startsWith("next/") ||
    spec === "server-only" ||
    spec === "client-only" ||
    spec.includes("supabase")
  );
}

function stubContents(spec: string): string {
  if (spec.startsWith("next/font")) {
    return `
      const font = () => ({ className: "", variable: "", style: {} });
      export const Inter = font;
      export const Geist = font;
      export const Geist_Mono = font;
      export const Fraunces = font;
      export const Source_Sans_3 = font;
      export default font;
    `;
  }
  if (spec === "next/navigation" || spec.startsWith("next/navigation")) {
    return `
      export function useRouter() {
        return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {}, forward() {} };
      }
      export function usePathname() { return "/"; }
      export function useSearchParams() { return new URLSearchParams(); }
      export function useParams() { return {}; }
      export function redirect() {}
      export function notFound() {}
      export function useSelectedLayoutSegment() { return null; }
    `;
  }
  if (spec === "next/link") {
    return `
      import { createElement } from "react";
      export default function Link(props) {
        return createElement("a", { href: props.href, className: props.className }, props.children);
      }
    `;
  }
  if (spec === "next/image") {
    return `
      import { createElement } from "react";
      export default function Image(props) {
        return createElement("img", {
          src: typeof props.src === "string" ? props.src : props.src?.src,
          alt: props.alt || "",
          className: props.className,
          width: props.width,
          height: props.height,
        });
      }
    `;
  }
  if (spec === "next/dynamic") {
    return `
      import { createElement, useEffect, useState } from "react";
      export default function dynamic(loader) {
        return function Dynamic(props) {
          const [Comp, setComp] = useState(null);
          useEffect(() => {
            Promise.resolve(loader()).then((mod) => {
              setComp(() => mod?.default ?? mod);
            });
          }, []);
          return Comp ? createElement(Comp, props) : null;
        };
      }
    `;
  }
  if (spec.includes("supabase")) {
    return `
      export function createClient() {
        return {
          auth: {
            signOut: async () => ({}),
            getUser: async () => ({ data: { user: null }, error: null }),
            getSession: async () => ({ data: { session: null }, error: null }),
          },
        };
      }
      export function createBrowserClient() { return createClient(); }
      export function createServerClient() { return createClient(); }
    `;
  }
  return "export default {};";
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveAppFile(appRoot: string, spec: string): Promise<string | null> {
  const rel = spec.replace(/^\/+/, "");
  for (const root of [appRoot, path.join(appRoot, "src")]) {
    const base = path.join(root, rel);
    const candidates = [
      base,
      `${base}.tsx`,
      `${base}.ts`,
      `${base}.jsx`,
      `${base}.js`,
      path.join(base, "index.tsx"),
      path.join(base, "index.ts"),
    ];
    for (const file of candidates) {
      if (await fileExists(file)) return file;
    }
  }
  return null;
}

function loadEsbuild(): {
  build: (opts: Record<string, unknown>) => Promise<unknown>;
} | null {
  try {
    const requireFromApp = createRequire(path.join(process.cwd(), "package.json"));
    return requireFromApp("esbuild") as {
      build: (opts: Record<string, unknown>) => Promise<unknown>;
    };
  } catch {
    return null;
  }
}

function entrySource(island: LiveIsland, appRoot: string): string {
  const rel = "./" + path.relative(appRoot, island.file).split(path.sep).join("/");
  const importLine =
    island.exportName === "default"
      ? `import Component from ${JSON.stringify(rel)};`
      : `import { ${island.exportName} as Component } from ${JSON.stringify(rel)};`;
  const callbacks = island.callbacks
    .map((name) => `${JSON.stringify(name)}: function () {}`)
    .join(",\n    ");
  return `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
${importLine}
const el = document.getElementById(${JSON.stringify(island.id)});
if (el) {
  const props = {
    ...${JSON.stringify(island.props)},
    ${callbacks}
  };
  createRoot(el).render(createElement(Component, props));
}
`;
}

export async function bundleLiveIslands(
  appRoot: string,
  islands: LiveIsland[],
): Promise<string[]> {
  if (!islands.length) return [];
  const esbuild = loadEsbuild();
  if (!esbuild) return [];

  const keys: string[] = [];
  const cache = store();
  const nodePaths = [
    path.join(appRoot, "node_modules"),
    path.join(process.cwd(), "node_modules"),
  ];

  for (const island of islands) {
    const key = liveIslandKey(island);
    if (cache.has(key)) {
      keys.push(key);
      continue;
    }
    try {
      const result = (await esbuild.build({
        absWorkingDir: appRoot,
        nodePaths,
        stdin: {
          contents: entrySource(island, appRoot),
          resolveDir: appRoot,
          loader: "tsx",
          sourcefile: `seethrough-${island.id}.tsx`,
        },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "es2020",
        jsx: "automatic",
        minify: true,
        logLevel: "silent",
        define: {
          "process.env.NODE_ENV": '"production"',
        },
        loader: {
          ".tsx": "tsx",
          ".ts": "ts",
          ".jsx": "jsx",
          ".js": "js",
          ".css": "empty",
          ".svg": "empty",
          ".png": "empty",
          ".jpg": "empty",
          ".jpeg": "empty",
          ".webp": "empty",
          ".gif": "empty",
          ".woff": "empty",
          ".woff2": "empty",
        },
        plugins: [
          {
            name: "seethrough-live-island",
            setup(build: {
              onResolve: (
                opts: { filter: RegExp },
                cb: (args: { path: string }) => unknown,
              ) => void;
              onLoad: (
                opts: { filter: RegExp; namespace?: string },
                cb: (args: { path: string }) => unknown,
              ) => void;
            }) {
              build.onResolve({ filter: /.*/ }, (args) => {
                if (shouldStub(args.path)) {
                  return { path: args.path, namespace: "st-stub" };
                }
                if (args.path.startsWith("@/")) {
                  return {
                    path: args.path.slice(2),
                    namespace: "st-at",
                  };
                }
                return undefined;
              });
              build.onLoad({ filter: /.*/, namespace: "st-stub" }, (args) => ({
                contents: stubContents(args.path),
                loader: "js",
              }));
              build.onLoad({ filter: /.*/, namespace: "st-at" }, async (args) => {
                const file = await resolveAppFile(appRoot, args.path);
                if (!file) return { contents: "export default {};", loader: "js" };
                const loader = file.endsWith(".ts")
                  ? "ts"
                  : file.endsWith(".tsx")
                    ? "tsx"
                    : file.endsWith(".jsx")
                      ? "jsx"
                      : "js";
                const { readFile } = await import("node:fs/promises");
                return { contents: await readFile(file, "utf8"), loader, resolveDir: path.dirname(file) };
              });
            },
          },
        ],
      })) as { outputFiles?: Array<{ text: string }> };

      const js = result.outputFiles?.[0]?.text;
      if (!js) continue;
      cache.set(key, js);
      keys.push(key);
    } catch {
      /* keep the static fallback for this island */
    }
  }
  return keys;
}
