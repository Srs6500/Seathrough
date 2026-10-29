import type { InspectReuse, InspectTarget } from "@/lib/vibe-coder/inspectTypes";

function isPageFile(file: string): boolean {
  return /(?:^|\/)page\.(tsx|jsx|js)$/i.test(file);
}

function isLayoutFile(file: string): boolean {
  return /(?:^|\/)layout\.(tsx|jsx|js)$/i.test(file);
}

export function isBrandStyle(cls: string): boolean {
  return /\[#(?:[0-9a-f]{3,8})\]/i.test(cls) || /\[rgba?\([^)]+\)\]/i.test(cls) || /\[hsla?\([^)]+\)\]/i.test(cls);
}

function prettyComponent(target: InspectTarget): string {
  const name = target.component?.trim() ?? "";
  if (name && !/^(default|Page|Home)$/i.test(name)) {
    return name.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  const base = target.file.split("/").pop()?.replace(/\.(tsx|jsx|ts|js)$/i, "") ?? target.file;
  return base.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function brandLabel(cls: string): string | null {
  const hex = cls.match(/\[(#(?:[0-9a-f]{3,8}))\]/i)?.[1];
  if (hex) {
    const role = /bg-|from-|to-/.test(cls) ? "fill" : /text-/.test(cls) ? "text" : /border-/.test(cls) ? "border" : "color";
    return `${hex.toLowerCase()} ${role}`;
  }
  const rgb = cls.match(/\[(rgba?\([^)]+\))\]/i)?.[1];
  if (rgb) {
    const role = /bg-/.test(cls) ? "surface" : /text-/.test(cls) ? "text" : "color";
    return `${rgb} ${role}`;
  }
  return null;
}

export function buildReuse(targets: InspectTarget[]): InspectReuse[] {
  const byFile = new Map<string, { name: string; routes: Set<string> }>();
  const byLook = new Map<string, { name: string; routes: Set<string> }>();

  for (const target of targets) {
    if (!isPageFile(target.file) && !isLayoutFile(target.file)) {
      const hit = byFile.get(target.file) ?? { name: prettyComponent(target), routes: new Set() };
      hit.routes.add(target.route);
      byFile.set(target.file, hit);
    }
    for (const cls of target.what.styles) {
      if (!isBrandStyle(cls)) continue;
      const name = brandLabel(cls);
      if (!name) continue;
      const hit = byLook.get(name) ?? { name, routes: new Set() };
      hit.routes.add(target.route);
      byLook.set(name, hit);
    }
  }

  const reuse: InspectReuse[] = [];
  for (const [file, row] of byFile) {
    reuse.push({
      kind: "component",
      name: row.name,
      file,
      routes: [...row.routes],
      detail:
        row.routes.size > 1
          ? `Used on ${row.routes.size} pages. Editing ${file} updates all of them.`
          : `Only rendered on this page.`,
    });
  }
  for (const row of byLook.values()) {
    if (row.routes.size < 2) continue;
    reuse.push({
      kind: "look",
      name: row.name,
      routes: [...row.routes],
      detail: `This color shows up on ${row.routes.size} pages.`,
    });
  }
  return reuse;
}

export function reuseOnRoute(reuse: InspectReuse[], route: string): {
  shared: InspectReuse[];
  only: InspectReuse[];
  looks: InspectReuse[];
} {
  const components = reuse.filter((item) => item.kind === "component" && item.routes.includes(route));
  return {
    shared: components.filter((item) => item.routes.length > 1),
    only: components.filter((item) => item.routes.length === 1),
    looks: reuse.filter((item) => item.kind === "look" && item.routes.includes(route)),
  };
}
