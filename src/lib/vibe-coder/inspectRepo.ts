import path from "node:path";
import { mergeUsage } from "@/lib/vibe-coder/inspectBuild";
import { buildInspectOverview } from "@/lib/vibe-coder/inspectOverview";
import { buildReuse, isBrandStyle } from "@/lib/vibe-coder/inspectReuse";
import type {
  InspectNote,
  InspectPage,
  InspectReport,
  InspectToken,
} from "@/lib/vibe-coder/inspectTypes";
import { discoverPreviewPages } from "@/lib/vibe-coder/previewPages";
import { bundleLiveIslands } from "@/lib/vibe-coder/liveIsland";
import { renderSourceMarkup } from "@/lib/vibe-coder/renderSourcePage";
import { ensureSourceTree } from "@/lib/vibe-coder/sourceCheckout";
import { loadPageTheme, pageDocument } from "@/lib/vibe-coder/sourceStyles";

const reportCache = new Map<string, InspectReport>();

export async function buildInspectReport(input: {
  fullName: string;
  token?: string;
  ref?: string;
}): Promise<InspectReport> {
  const key = `v9:${input.fullName.trim().toLowerCase()}`;
  const hit = reportCache.get(key);
  if (hit) return hit;

  const tree = await ensureSourceTree(input);
  const pages = await discoverPreviewPages(tree.appRoot);
  const listed: InspectPage[] = pages.map((page) => ({
    route: page.route,
    name: page.name,
    file: page.file,
  }));

  const allTargets = [];
  for (const page of listed) {
    const markup = await renderSourceMarkup({
      appRoot: tree.appRoot,
      file: path.join(tree.appRoot, page.file),
      route: page.route,
      pageName: page.name,
      inspect: true,
    });
    allTargets.push(...markup.targets);
  }

  const targets = mergeUsage(allTargets);
  const tokenMap = new Map<string, Set<string>>();
  for (const target of targets) {
    for (const cls of target.what.styles) {
      if (!isBrandStyle(cls)) continue;
      if (!tokenMap.has(cls)) tokenMap.set(cls, new Set());
      tokenMap.get(cls)!.add(target.route);
    }
  }
  const tokens: InspectToken[] = [...tokenMap.entries()]
    .filter(([, pagesUsing]) => pagesUsing.size > 0)
    .map(([name, pagesUsing]) => ({
      name,
      kind: name.startsWith("font-") ? ("type" as const) : ("color" as const),
      pages: [...pagesUsing],
    }))
    .slice(0, 24);

  const seen = new Set<string>();
  const attention: InspectNote[] = [];
  for (const target of targets) {
    for (const note of target.attention) {
      const dedupe = `${note.area}:${note.title}:${target.route}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      attention.push(note);
    }
  }

  const overview = await buildInspectOverview({
    appRoot: tree.appRoot,
    targets,
  });
  const reuse = buildReuse(targets);
  const report: InspectReport = { pages: listed, targets, tokens, attention, overview, reuse };
  reportCache.set(key, report);
  return report;
}

export async function renderInspectPage(input: {
  fullName: string;
  route: string;
  token?: string;
  ref?: string;
}): Promise<{ html: string }> {
  const tree = await ensureSourceTree(input);
  const pages = await discoverPreviewPages(tree.appRoot);
  const page = pages.find((item) => item.route === input.route);
  if (!page) throw new Error("That page is not in this repository.");
  const theme = await loadPageTheme(tree.appRoot);
  const markup = await renderSourceMarkup({
    appRoot: tree.appRoot,
    file: path.join(tree.appRoot, page.file),
    route: page.route,
    pageName: page.name,
    inspect: true,
  });
  const islandKeys = await bundleLiveIslands(tree.appRoot, markup.islands);
  return {
    html: pageDocument({
      title: page.name,
      body: markup.html,
      theme,
      bodyClass: markup.bodyClass,
      inspect: true,
      islandKeys,
    }),
  };
}
