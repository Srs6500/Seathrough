import { getTavilyConfig } from "@/lib/env";
import { isCredibleSourceUrl } from "@/lib/providers/tavily";
import type { TeachingImage } from "@/lib/voice-tutor/images/types";

/**
 * Image lookups, most trustworthy first:
 *  1. Wikipedia article lead image — editor-curated, hosted on Wikimedia Commons.
 *  2. Wikimedia Commons file search — freely licensed, with author + license.
 *  3. Tavily image search, kept only when the image is hosted by a credible
 *     institution (.edu / .gov / NASA / NIH / journals — see isCredibleSourceUrl).
 *
 * Every lookup is fail-soft: a timeout or bad response just yields null.
 */

const UA = "SeeThroughTutor/1.0 (educational tutor; image lookup)";
const TIMEOUT_MS = 5_000;
const THUMB_WIDTH = 960;

type ImageInfo = {
  url?: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width?: number;
  height?: number;
  mime?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, { value?: unknown } | undefined>;
};

type WikiPage = {
  title?: string;
  missing?: boolean;
  pageimage?: string;
  imageinfo?: ImageInfo[];
};

async function wikiApi(host: string, params: Record<string, string>): Promise<WikiPage[]> {
  const url = new URL(`https://${host}/w/api.php`);
  for (const [k, v] of Object.entries({ action: "query", format: "json", formatversion: "2", ...params })) {
    url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Api-User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { query?: { pages?: WikiPage[] } };
    return json.query?.pages ?? [];
  } catch {
    return [];
  }
}

function stripHtml(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanUrl(href: string): string {
  try {
    const url = new URL(href);
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return href;
  }
}

/** Not something to teach from: logos, flags, icons, maps of nothing, etc. */
const JUNK_FILE = /\b(logo|icon|flag|signature|coat of arms|emblem|wordmark|seal of|blank|placeholder|stub|button|banner)\b/i;
const OK_MIME = /^image\/(png|jpeg|svg\+xml|gif|webp)$/;

function imageFromInfo(info: ImageInfo, fileTitle: string, caption: string): TeachingImage | null {
  if (!info.thumburl || !info.thumbwidth || !info.thumbheight) return null;
  if (info.mime && !OK_MIME.test(info.mime)) return null;
  // Too small to read on a board.
  if ((info.width ?? 0) < 320 || (info.height ?? 0) < 200) return null;
  const meta = info.extmetadata ?? {};
  // Non-free files (fair use) can't be reused here.
  if (stripHtml(meta.NonFree?.value) === "true") return null;
  const name = fileTitle.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
  const description = stripHtml(meta.ImageDescription?.value, 240);
  return {
    url: cleanUrl(info.thumburl),
    width: info.thumbwidth,
    height: info.thumbheight,
    caption,
    alt: description || name,
    credit: stripHtml(meta.Artist?.value, 120) || stripHtml(meta.Credit?.value, 120) || "Wikimedia Commons contributor",
    license: stripHtml(meta.LicenseShortName?.value, 60),
    sourceUrl: cleanUrl(info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle)}`),
    sourceName: "Wikimedia Commons",
  };
}

const IMAGEINFO = {
  prop: "imageinfo",
  iiprop: "url|size|mime|extmetadata",
  iiurlwidth: String(THUMB_WIDTH),
  iiextmetadatafilter: "LicenseShortName|Artist|Credit|ImageDescription|NonFree",
};

/** Lead image of the Wikipedia article `title`, if it is a free Commons file. */
export async function wikipediaLeadImage(title: string, caption: string): Promise<TeachingImage | null> {
  const pages = await wikiApi("en.wikipedia.org", {
    titles: title,
    redirects: "1",
    prop: "pageimages",
    piprop: "name",
  });
  const file = pages.find((p) => !p.missing && p.pageimage)?.pageimage;
  if (!file || JUNK_FILE.test(file)) return null;
  // Asking Commons directly also filters out local (non-free) Wikipedia files.
  const filePages = await wikiApi("commons.wikimedia.org", { titles: `File:${file}`, ...IMAGEINFO });
  const page = filePages.find((p) => !p.missing && p.imageinfo?.length);
  const info = page?.imageinfo?.[0];
  return info ? imageFromInfo(info, page?.title ?? `File:${file}`, caption) : null;
}

function keyTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^(diagram|image|photo|picture|labeled|labelled|showing|structure|with|from|into|that|this)$/.test(w));
}

/** Best-matching freely licensed file on Wikimedia Commons. */
export async function commonsSearchImage(query: string, caption: string): Promise<TeachingImage | null> {
  const pages = await wikiApi("commons.wikimedia.org", {
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap|drawing`,
    gsrlimit: "8",
    ...IMAGEINFO,
  });
  const keys = keyTokens(query);
  const ranked = pages
    .map((page, order) => {
      const title = page.title ?? "";
      const hay = title.toLowerCase();
      const hits = keys.filter((k) => hay.includes(k)).length;
      return { page, order, hits, junk: JUNK_FILE.test(title) };
    })
    // The file name must actually mention the subject — Commons search is loose.
    .filter((r) => !r.junk && (keys.length === 0 || r.hits > 0))
    .sort((a, b) => b.hits - a.hits || a.order - b.order);
  for (const { page } of ranked) {
    const info = page.imageinfo?.[0];
    const image = info ? imageFromInfo(info, page.title ?? "", caption) : null;
    if (image) return image;
  }
  return null;
}

/** Image hosted by a credible institution, via Tavily image search. */
export async function credibleWebImage(query: string, caption: string): Promise<TeachingImage | null> {
  const apiKey = getTavilyConfig().apiKey;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: "basic",
        max_results: 5,
        include_images: true,
        include_image_descriptions: true,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS + 2_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { images?: Array<string | { url?: string; description?: string }> };
    for (const raw of json.images ?? []) {
      const href = typeof raw === "string" ? raw : raw?.url;
      if (!href || !/\.(png|jpe?g|webp|svg)(\?|$)/i.test(href)) continue;
      if (!isCredibleSourceUrl(href)) continue;
      const host = new URL(href).hostname.replace(/^www\./, "");
      const description = typeof raw === "string" ? "" : stripHtml(raw.description, 240);
      // Real pixel size is unknown here; the board letterboxes into a 4:3 frame.
      return {
        url: href,
        width: 960,
        height: 720,
        caption,
        alt: description || caption,
        credit: host,
        license: "",
        sourceUrl: href,
        sourceName: host,
      };
    }
  } catch {
    /* fail-soft */
  }
  return null;
}

/**
 * The caption is written before the picture is found. If the picture's own
 * description doesn't back it up, caption with what the file says it shows.
 */
function honestCaption(image: TeachingImage): TeachingImage {
  const keys = keyTokens(image.caption);
  const hay = image.alt.toLowerCase();
  if (!keys.length || keys.some((k) => hay.includes(k))) return image;
  const words = image.alt.replace(/\s*[([].*$/, "").split(/\s+/).slice(0, 9).join(" ");
  return words ? { ...image, caption: words } : image;
}

function tidyCredit(image: TeachingImage): TeachingImage {
  const credit = image.credit.replace(/\s+,/g, ",").split(/\s:\s/)[0]!.trim();
  return { ...image, credit: credit || image.credit };
}

/** Try each source in order of trust; first usable picture wins. */
export async function findTeachingImage(input: {
  wikiTitle?: string;
  query: string;
  caption: string;
}): Promise<TeachingImage | null> {
  const found =
    (input.wikiTitle ? await wikipediaLeadImage(input.wikiTitle, input.caption) : null) ??
    (await commonsSearchImage(input.query, input.caption)) ??
    (await credibleWebImage(input.query, input.caption));
  return found ? tidyCredit(honestCaption(found)) : null;
}
