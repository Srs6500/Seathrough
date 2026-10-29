import path from "node:path";
import { discoverPreviewPages, type PreviewPage } from "@/lib/vibe-coder/previewPages";
import { bundleLiveIslands } from "@/lib/vibe-coder/liveIsland";
import { renderSourceMarkup } from "@/lib/vibe-coder/renderSourcePage";
import { pageDocument, loadPageTheme } from "@/lib/vibe-coder/sourceStyles";
import { ensureSourceTree, type SourceTree } from "@/lib/vibe-coder/sourceCheckout";

export type SourcePage = PreviewPage;

export async function listSourcePages(input: {
  fullName: string;
  token?: string;
  ref?: string;
}): Promise<{ tree: SourceTree; pages: SourcePage[] }> {
  const tree = await ensureSourceTree(input);
  const pages = await discoverPreviewPages(tree.appRoot);
  return { tree, pages };
}

export async function renderSourcePageDocument(input: {
  fullName: string;
  route: string;
  token?: string;
  ref?: string;
}): Promise<{ html: string; page: SourcePage }> {
  const { tree, pages } = await listSourcePages(input);
  const page = pages.find((item) => item.route === input.route);
  if (!page) throw new Error("That page is not in this repository.");
  const theme = await loadPageTheme(tree.appRoot);
  const markup = await renderSourceMarkup({
    appRoot: tree.appRoot,
    file: path.join(tree.appRoot, page.file),
  });
  const islandKeys = await bundleLiveIslands(tree.appRoot, markup.islands);
  return {
    page,
    html: pageDocument({
      title: page.name,
      body: markup.html,
      theme,
      bodyClass: markup.bodyClass,
      islandKeys,
    }),
  };
}
