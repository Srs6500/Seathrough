import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  classifyPackage,
  detectPackageManager,
  devCommand,
  findDevApp,
  looksReady,
} from "../src/lib/bug-analyzer/detectDevApp";
import {
  discoverPreviewPages,
  fileToRoute,
  isAuthRoute,
  isSkippableRoute,
  loginRouteOf,
  routeName,
} from "../src/lib/vibe-coder/previewPages";
import { mergeUsage } from "../src/lib/vibe-coder/inspectBuild";
import { buildInspectOverview } from "../src/lib/vibe-coder/inspectOverview";
import { buildReuse, isBrandStyle, reuseOnRoute } from "../src/lib/vibe-coder/inspectReuse";
import {
  bundleLiveIslands,
  getLiveIslandScript,
  sourceNeedsLiveRuntime,
} from "../src/lib/vibe-coder/liveIsland";
import { renderSourceMarkup } from "../src/lib/vibe-coder/renderSourcePage";

assert.equal(classifyPackage({}).score, 0);
assert.equal(classifyPackage({ dependencies: { next: "16.0.0" } }).kind, "next");
assert.equal(
  classifyPackage({
    dependencies: { vite: "6.0.0", react: "19.0.0" },
    scripts: { dev: "vite" },
  }).kind,
  "vite",
);
assert.equal(
  classifyPackage({
    dependencies: { "react-scripts": "5.0.0", react: "18.0.0" },
    scripts: { start: "react-scripts start" },
  }).kind,
  "cra",
);
assert.equal(classifyPackage({ scripts: { dev: "node server.js" } }).kind, "script");

assert.equal(looksReady("Ready in 1200ms"), true);
assert.equal(looksReady("  ➜  Local:   http://127.0.0.1:5173/"), true);
assert.equal(looksReady("Compiled successfully!"), true);
assert.equal(looksReady("waiting for file changes"), false);
assert.equal(looksReady(""), false);

const nextDev = devCommand("next", { name: "npm", install: { command: "npm", args: [] } }, 3101, "dev");
assert.equal(nextDev.command, "npx");
assert.ok(nextDev.args.includes("3101"));
assert.ok(nextDev.args.includes("127.0.0.1"));

const viteDev = devCommand(
  "vite",
  { name: "pnpm", install: { command: "pnpm", args: ["install"] } },
  5173,
  "dev",
);
assert.deepEqual(viteDev.args.slice(0, 2), ["exec", "vite"]);

async function withTemp(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibe-preview-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  await withTemp(async (dir) => {
    assert.equal(await findDevApp(dir), null);
  });

  await withTemp(async (dir) => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "root", dependencies: { next: "16.0.0" } }),
    );
    const app = await findDevApp(dir);
    assert.equal(app?.kind, "next");
    assert.equal(app?.relativeRoot, ".");
    assert.equal(app?.installRoot, dir);
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "web"), { recursive: true });
    await writeFile(path.join(dir, "README.md"), "no app at root");
    await writeFile(
      path.join(dir, "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "14.0.0", react: "18.0.0" },
        scripts: { dev: "next dev" },
      }),
    );
    const app = await findDevApp(dir);
    assert.equal(app?.kind, "next");
    assert.equal(app?.relativeRoot, "web");
    assert.equal(app?.installRoot, path.join(dir, "web"));
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "web"), { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "mono",
        private: true,
        workspaces: ["web"],
        scripts: { dev: "echo no" },
      }),
    );
    await writeFile(
      path.join(dir, "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { vite: "6.0.0", react: "19.0.0" },
        scripts: { dev: "vite" },
      }),
    );
    const app = await findDevApp(dir);
    assert.equal(app?.kind, "vite");
    assert.equal(app?.relativeRoot, "web");
    assert.equal(app?.installRoot, dir);
  });

  await withTemp(async (dir) => {
    await writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    const pm = await detectPackageManager(dir);
    assert.equal(pm.name, "pnpm");
  });

  await withTemp(async (dir) => {
    await writeFile(path.join(dir, "package.json"), "{ not json");
    assert.equal(await findDevApp(dir), null);
  });

  assert.equal(fileToRoute("web/src/app/page.tsx"), "/");
  assert.equal(fileToRoute("web/src/app/login/page.tsx"), "/login");
  assert.equal(fileToRoute("src/app/(main)/collection/page.tsx"), "/collection");
  assert.equal(fileToRoute("src/app/matters/[id]/page.tsx"), "/matters/:id");
  assert.equal(fileToRoute("pages/api/health.ts"), null);
  assert.equal(fileToRoute("src/lib/db.ts"), null);
  assert.equal(isSkippableRoute("/matters/:id"), true);
  assert.equal(isSkippableRoute("/api/login"), true);
  assert.equal(isAuthRoute("/login"), true);
  assert.equal(isAuthRoute("/workspace"), false);
  assert.equal(routeName("/"), "Home");
  assert.equal(routeName("/login"), "Log in");

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app/login"), { recursive: true });
    await mkdir(path.join(dir, "src/app/matters/[id]"), { recursive: true });
    await writeFile(path.join(dir, "src/app/page.tsx"), "export default function Home(){return null}");
    await writeFile(path.join(dir, "src/app/login/page.tsx"), "export default function Login(){return null}");
    await writeFile(
      path.join(dir, "src/app/matters/[id]/page.tsx"),
      "export default function Matter(){return null}",
    );
    const pages = await discoverPreviewPages(dir);
    assert.deepEqual(
      pages.map((page) => page.route).sort(),
      ["/", "/login"].sort(),
    );
    assert.equal(loginRouteOf(pages), "/login");
  });

  await withTemp(async (dir) => {
    assert.equal((await discoverPreviewPages(dir))[0]?.route, "/");
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app/login"), { recursive: true });
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `import { redirect } from "next/navigation";
export default function Home() {
  const session = null;
  if (!session) redirect("/login");
  return <main><h1>Workspace</h1></main>;
}`,
    );
    await writeFile(
      path.join(dir, "src/app/login/page.tsx"),
      `function LoginForm() {
  return (
    <form>
      <input type="email" name="email" placeholder="name@firm.com" />
      <input type="password" name="password" />
      <button type="submit">Sign in</button>
    </form>
  );
}
export default function LoginPage() {
  return (
    <main>
      <h1>Hale office</h1>
      <LoginForm />
    </main>
  );
}`,
    );
    const login = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/login/page.tsx",
    });
    assert.match(login.html, /Hale office/);
    assert.match(login.html, /type="email"/);
    assert.match(login.html, /Sign in/);
    const home = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
    });
    assert.match(home.html, /Workspace/);
    assert.doesNotMatch(home.html, /redirect/);

    const inspected = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/login/page.tsx",
      route: "/login",
      pageName: "Log in",
      inspect: true,
    });
    assert.ok(inspected.targets.length > 0);
    assert.match(inspected.html, /data-st-id="st-1"/);
    const signIn = inspected.targets.find((target) => /sign in/i.test(target.name));
    assert.ok(signIn);
    assert.equal(signIn?.how.action === "api" || signIn?.how.action === "submit", true);
    const email = inspected.targets.find((target) => target.kind === "input");
    assert.equal(email?.what.origin, "user");
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app"), { recursive: true });
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `export default function Page() {
  return (
    <main>
      <section className="bg-white p-8">
        <h1>Firm</h1>
        <div className="mt-8 h-px bg-black" />
        <form>
          <input name="email" />
          <textarea placeholder="Ask" />
          <button type="submit">Ask</button>
        </form>
      </section>
    </main>
  );
}`,
    );
    const page = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
    });
    assert.match(page.html, /<div class="mt-8 h-px bg-black"><\/div>/);
    assert.match(page.html, /<textarea[^>]*><\/textarea>/);
    assert.doesNotMatch(page.html, /<div [^>]*\/>/);
    assert.doesNotMatch(page.html, /<textarea[^>]*\/>/);
    assert.match(page.html, /<\/textarea>\s*<button/);
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app"), { recursive: true });
    await mkdir(path.join(dir, "src/components"), { recursive: true });
    await writeFile(
      path.join(dir, "src/components/Wave.tsx"),
      `export function Wave({ title }: { title: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>Ask anything</p>
    </section>
  );
}`,
    );
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `import dynamic from "next/dynamic";
const Wave = dynamic(() => import("../components/Wave").then((m) => m.Wave));
export default function Page() {
  const mobileOpen = false;
  return (
    <main className="min-h-screen bg-[#0a0a0f]">
      <Wave title="Research with AI." />
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50" />}
    </main>
  );
}`,
    );
    const page = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
    });
    assert.match(page.html, /Research with AI/);
    assert.match(page.html, /Ask anything/);
    assert.doesNotMatch(page.html, /bg-black\/50/);
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app"), { recursive: true });
    await mkdir(path.join(dir, "src/components"), { recursive: true });
    await writeFile(
      path.join(dir, "src/components/Hero.tsx"),
      `import { useState } from "react";
export function Hero({ onBack }: { onBack?: () => void }) {
  const base = "What is ";
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState(base);
  return (
    <section>
      {onBack && <button>Back</button>}
      <input placeholder={animatedPlaceholder} />
    </section>
  );
}`,
    );
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `import { Hero } from "../components/Hero";
export default function Page() {
  return <Hero />;
}`,
    );
    const page = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
    });
    assert.doesNotMatch(page.html, />Back</);
    assert.match(page.html, /placeholder="What is /);
    assert.doesNotMatch(page.html, /Animated Placeholder/);
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app"), { recursive: true });
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `export default function Page({ children }: { children?: React.ReactNode }) {
  return (
    <section
      style={{
        position: "relative",
        height: "100vh",
        zIndex: 3,
        display: "flex",
        flexDirection: "column",
        alignItems: children ? "stretch" : "center",
        justifyContent: children ? "stretch" : "center",
      }}
    >
      <h1>Research with AI.</h1>
    </section>
  );
}`,
    );
    const page = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
    });
    assert.match(page.html, /justify-content:center/);
    assert.match(page.html, /align-items:center/);
    assert.match(page.html, /z-index:3/);
    assert.doesNotMatch(page.html, /z-index:3px/);
  });

  assert.equal(sourceNeedsLiveRuntime(`import * as THREE from "three";`), true);
  assert.equal(sourceNeedsLiveRuntime(`import { useState } from "react";`), false);

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app"), { recursive: true });
    await mkdir(path.join(dir, "src/components"), { recursive: true });
    await writeFile(
      path.join(dir, "src/components/Wave.tsx"),
      `import * as THREE from "three";
export function Wave({ title }: { title: string }) {
  return (
    <section aria-label="Animated hero">
      <h1>{title}</h1>
      <div id="waveCanvas" />
    </section>
  );
}
void THREE;
`,
    );
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `import { Wave } from "../components/Wave";
export default function Page() {
  return <Wave title="Research with AI." />;
}`,
    );
    const page = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
    });
    assert.match(page.html, /id="st-live-1"/);
    assert.match(page.html, /waveCanvas/);
    assert.match(page.html, /Research with AI/);
    assert.equal(page.islands.length, 1);
    assert.equal(page.islands[0]?.exportName, "Wave");
    assert.equal(page.islands[0]?.props.title, "Research with AI.");

    await mkdir(path.join(dir, "node_modules/three"), { recursive: true });
    await writeFile(
      path.join(dir, "node_modules/three/package.json"),
      JSON.stringify({ name: "three", type: "module", main: "index.js" }),
    );
    await writeFile(
      path.join(dir, "node_modules/three/index.js"),
      "export const WebGLRenderer = class {}; export default {};\n",
    );
    const keys = await bundleLiveIslands(dir, page.islands);
    assert.equal(keys.length, 1);
    const js = getLiveIslandScript(keys[0] ?? "");
    assert.ok(js && js.length > 200);
    assert.match(js, /st-live-1/);
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app"), { recursive: true });
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `export default function Overview() {
  return (
    <main>
      <section className="rounded-xl border p-4 shadow">
        <h2>Revenue</h2>
        <p>$12,450</p>
      </section>
      <button>Checkout</button>
      <img src="/hero.png" />
    </main>
  );
}`,
    );
    const overview = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
      route: "/",
      pageName: "Overview",
      inspect: true,
    });
    const checkout = overview.targets.find((target) => /checkout/i.test(target.name));
    assert.equal(checkout?.how.action, "none");
    assert.ok(checkout?.attention.some((note) => /does nothing/i.test(note.title)));
    const revenue = overview.targets.find((target) => /12,450|Revenue/i.test(target.text + target.name));
    assert.ok(revenue);
    assert.ok(
      revenue?.attention.some((note) => /hardcoded|loading or error/i.test(note.title)),
    );
    const image = overview.targets.find((target) => target.kind === "image");
    assert.ok(image?.attention.some((note) => /alt/i.test(note.title)));
    assert.ok(
      image?.attention.some((note) => /not measured live/i.test(`${note.title} ${note.detail}`)),
    );
  });

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app"), { recursive: true });
    await writeFile(
      path.join(dir, "src/app/globals.css"),
      `:root { --background: #0a0a0f; --foreground: #ededed; --accent: #1f3dbc; }
body { font-family: var(--font-sans), system-ui, sans-serif; }
`,
    );
    await writeFile(
      path.join(dir, "src/app/layout.tsx"),
      `import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
const geistSans = Geist({ variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono" });
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body className={geistSans.variable}>{children}</body></html>;
}
`,
    );
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `export default function Page() {
  return (
    <main className="bg-[#0a0a0f] text-white">
      <h1 className="text-5xl font-semibold tracking-tight">Research with AI.</h1>
      <span className="text-[13px] text-gray-500">Mode:</span>
      <button className="rounded-xl bg-[#f0f2ff] text-black w-10 h-10">Go</button>
      <button className="rounded-lg bg-white/10 text-white px-3 py-1.5">Chat</button>
      <button className="text-sm text-white/60">Notebook</button>
    </main>
  );
}`,
    );
    const page = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
      inspect: true,
    });
    const design = await buildInspectOverview({ appRoot: dir, targets: page.targets });
    assert.equal(design.fonts[0]?.role, "primary");
    assert.match(design.fonts[0]?.family ?? "", /Geist/i);
    assert.match(design.fonts[0]?.size ?? "", /px$/);
    assert.equal(design.fonts[1]?.role, "secondary");
    assert.match(design.fonts[1]?.size ?? "", /48px/);
    assert.equal(design.fonts[2]?.role, "tertiary");
    assert.match(design.fonts[2]?.family ?? "", /Geist Mono/i);
    assert.match(design.fonts[2]?.size ?? "", /px$/);
    assert.ok(design.palette.some((swatch) => /#0a0a0f/i.test(swatch.value)));
    assert.ok(design.palette.some((swatch) => /#1f3dbc|#f0f2ff|#ededed/i.test(swatch.value)));
    assert.equal(design.buttons.find((button) => button.role === "primary")?.fill.toLowerCase(), "#f0f2ff");
    assert.ok(design.buttons.some((button) => button.role === "secondary"));
    assert.ok(design.buttons.some((button) => button.role === "tertiary"));
  });

  assert.equal(isBrandStyle("font-medium"), false);
  assert.equal(isBrandStyle("text-white"), false);
  assert.equal(isBrandStyle("border-white/10"), false);
  assert.equal(isBrandStyle("bg-gradient-to-br"), false);
  assert.equal(isBrandStyle("bg-[rgba(15,15,20,0.55)]"), true);
  assert.equal(isBrandStyle("text-[#f0f2ff]"), true);

  await withTemp(async (dir) => {
    await mkdir(path.join(dir, "src/app/sign-in"), { recursive: true });
    await mkdir(path.join(dir, "src/components"), { recursive: true });
    await writeFile(
      path.join(dir, "src/components/Nav.tsx"),
      `export function Nav() {
  return (
    <nav className="bg-[#0a0a0f]">
      <a href="/sign-in" className="text-[#f0f2ff] font-medium">Sign in</a>
    </nav>
  );
}
`,
    );
    await writeFile(
      path.join(dir, "src/app/page.tsx"),
      `import { Nav } from "../components/Nav";
export default function Home() {
  return (
    <main className="text-white font-semibold bg-gradient-to-br from-black">
      <Nav />
      <h1 className="bg-[rgba(15,15,20,0.55)] border-white/10">Home</h1>
    </main>
  );
}
`,
    );
    await writeFile(
      path.join(dir, "src/app/sign-in/page.tsx"),
      `import { Nav } from "../../components/Nav";
export default function SignIn() {
  return (
    <main className="text-white font-medium border-white/10">
      <Nav />
      <h1 className="bg-[rgba(15,15,20,0.55)]">Sign in</h1>
    </main>
  );
}
`,
    );
    const home = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/page.tsx",
      route: "/",
      pageName: "Home",
      inspect: true,
    });
    const signIn = await renderSourceMarkup({
      appRoot: dir,
      file: "src/app/sign-in/page.tsx",
      route: "/sign-in",
      pageName: "Sign in",
      inspect: true,
    });
    const targets = mergeUsage([...home.targets, ...signIn.targets]);
    const reuse = buildReuse(targets);
    const homeReuse = reuseOnRoute(reuse, "/");
    assert.ok(
      homeReuse.shared.some((item) => item.kind === "component" && /Nav/i.test(item.name)),
      "shared Nav should be listed on Home",
    );
    assert.ok(homeReuse.shared.some((item) => item.routes.includes("/sign-in")));
    assert.ok(homeReuse.looks.some((item) => /#0a0a0f|#f0f2ff|rgba\(15,15,20/i.test(item.name)));
    assert.ok(!homeReuse.looks.some((item) => /font-medium|text-white|border-white|gradient/i.test(item.name)));
    assert.ok(targets.some((target) => target.how.usedOn.includes("/") && target.how.usedOn.includes("/sign-in")));
    assert.ok(!targets.some((target) => target.how.sharedWith.includes("font-medium")));
    assert.ok(!targets.some((target) => target.how.sharedWith.includes("text-white")));
  });

  console.log("vibe-preview smoke checks passed");
}

void main();
