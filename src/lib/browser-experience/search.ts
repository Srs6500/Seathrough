import { getTavilyConfig } from "@/lib/env";
import type { LessonSource } from "@/types/lesson";

const SEARCH_TIMEOUT_MS = 8_000;
const MAX_RESULTS = 6;

/** Domains that are great for student-facing explanations. */
const PREFERRED_DOMAINS = [
  "britannica.com",
  "openstax.org",
  "nasa.gov",
  "noaa.gov",
  "cdc.gov",
  "nhlbi.nih.gov",
  "ninds.nih.gov",
  "cancer.gov",
  "medlineplus.gov",
  "mayoclinic.org",
  "kidshealth.org",
  "edu",
  "khanacademy.org",
  "nationalgeographic.com",
  "smithsonianmag.com",
  "howstuffworks.com",
  "livescience.com",
  "space.com",
  "bbc.com",
  "bbc.co.uk",
  "wikipedia.org",
  "developer.mozilla.org",
  "react.dev",
  "python.org",
  "typescriptlang.org",
] as const;

/** Research dumps that look "credible" but teach poorly for simple questions. */
const DEPRIORITIZE_HOSTS = [
  "pmc.ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov/pmc",
  "sciencedirect.com",
  "link.springer.com",
  "onlinelibrary.wiley.com",
  "tandfonline.com",
  "jstor.org",
  "researchgate.net",
  "semanticscholar.org",
] as const;

const BLOCKED = [
  "reddit.com",
  "quora.com",
  "medium.com",
  "substack.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "pinterest.com",
  "fandom.com",
  "youtube.com",
] as const;

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
};

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    url.hostname = url.hostname.replace(/^www\./i, "");
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  if (domain === "edu") {
    return (
      hostname.endsWith(".edu") ||
      /\.(?:ac|edu)\.[a-z]{2}$/i.test(hostname)
    );
  }
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isBlocked(hostname: string): boolean {
  return BLOCKED.some((d) => hostMatches(hostname, d));
}

function scoreSource(url: URL, title: string, excerpt: string): number {
  const host = url.hostname.toLowerCase();
  let score = 1;
  if (PREFERRED_DOMAINS.some((d) => hostMatches(host, d))) score += 5;
  if (host.endsWith(".gov") || host.endsWith(".edu")) score += 3;
  if (DEPRIORITIZE_HOSTS.some((d) => host.includes(d.replace(/^www\./, "")))) {
    score -= 6;
  }
  if (/\/pmc\/articles\//i.test(url.pathname)) score -= 8;
  if (/\b(parts?|anatomy|explained|overview|introduction|basics)\b/i.test(title)) {
    score += 2;
  }
  if (excerpt.length > 120) score += 1;
  // Prefer shorter educational URLs over deep journal paths.
  if (url.pathname.split("/").filter(Boolean).length <= 3) score += 1;
  return score;
}

export async function searchBrowserSources(
  query: string,
  signal?: AbortSignal,
): Promise<LessonSource[]> {
  const apiKey = getTavilyConfig().apiKey;
  const trimmed = query.trim().slice(0, 400);
  if (!apiKey || !trimmed) return [];

  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeout])
    : timeout;

  const wantsVisual =
    /\b(diagram|figure|picture|image|parts?|anatomy|labeled|labelled|lobes?)\b/i.test(
      trimmed,
    );
  // Learner-focused query — NOT "peer-reviewed research" (that pulls PMC papers).
  const searchQuery = wantsVisual
    ? `${trimmed} labeled diagram parts explained for students`
    : `${trimmed} explained for students overview`;

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: searchQuery,
      topic: "general",
      search_depth: "advanced",
      chunks_per_source: 2,
      max_results: 14,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      exclude_domains: [
        ...BLOCKED,
        "pmc.ncbi.nlm.nih.gov",
        "pubmed.ncbi.nlm.nih.gov",
        "researchgate.net",
      ],
    }),
    signal: combinedSignal,
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }

  const json = (await response.json()) as { results?: TavilyResult[] };
  const ranked: Array<LessonSource & { score: number }> = [];
  const seen = new Set<string>();

  for (const raw of json.results ?? []) {
    const url = safeUrl(raw?.url);
    const title = cleanText(raw?.title, 240);
    const excerpt = cleanText(raw?.content, 800);
    if (!url || url.protocol !== "https:" || !title || !excerpt) continue;
    if (isBlocked(url.hostname.toLowerCase())) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    ranked.push({
      id: "tmp",
      title,
      url: url.href,
      publisher: url.hostname.replace(/^www\./, ""),
      excerpt,
      score: scoreSource(url, title, excerpt),
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, MAX_RESULTS).map((item, index) => ({
    id: `S${index + 1}`,
    title: item.title,
    url: item.url,
    publisher: item.publisher,
    excerpt: item.excerpt,
  }));
}

/** True diagram / schematic language — required before we open a tab. */
const DIAGRAM_EVIDENCE =
  /\b(diagram|schematic|schematics|flowchart|flow chart|cross[- ]?section|labeled|labelled|anatomy chart|parts of|exploded view|block diagram|circuit diagram|wireframe|infographic|concept map|mind map|tree diagram|venn diagram|cycle diagram|process diagram|structure of|overview diagram|educational diagram|illustration of the)\b/i;

/** Photo / stock / lifestyle cues — hard reject. */
const PHOTO_REJECT =
  /\b(photo|photograph|photography|portrait|selfie|stock photo|shutterstock|getty|unsplash|pexels|wallpaper|screenshot of app|product shot|lifestyle|wedding|celebrity|actor|actress|meme|logo only|favicon|icon pack|emoji)\b/i;

/** Stock / photo CDNs — not diagrams. */
const DIAGRAM_BLOCK_HOSTS = [
  ...BLOCKED,
  "flickr.com",
  "staticflickr.com",
  "live.staticflickr.com",
  "shutterstock.com",
  "gettyimages.com",
  "unsplash.com",
  "pexels.com",
  "istockphoto.com",
  "dreamstime.com",
  "alamy.com",
  "pinterest.com",
] as const;

/** Soft floor: diagram evidence + topic relevance (no trust gate). */
const MIN_DIAGRAM_SCORE = 8;

function decodePathTokens(path: string): string {
  try {
    return decodeURIComponent(path).replace(/[_+.-]+/g, " ");
  } catch {
    return path.replace(/[_+.-]+/g, " ");
  }
}

/** Filename / path / description must look like a real diagram, not a photo. */
export function hasDiagramEvidence(text: string): boolean {
  return DIAGRAM_EVIDENCE.test(text);
}

export function isLikelyDiagramImageUrl(href: string): boolean {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    if (DIAGRAM_BLOCK_HOSTS.some((d) => hostMatches(host, d))) return false;

    const path = url.pathname.toLowerCase();
    const pathTokens = decodePathTokens(path);
    const isImageExt = /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(path);
    const isWikiMedia = /upload\.wikimedia\.org|commons\.wikimedia\.org/i.test(
      host,
    );

    // Must be an image asset (or Wikimedia file path).
    if (!isImageExt && !isWikiMedia) return false;

    // Hard reject photo filenames / stock cues — not diagrams.
    if (PHOTO_REJECT.test(pathTokens) || PHOTO_REJECT.test(host)) return false;

    // Path must look like a diagram / schematic / labeled figure.
    if (hasDiagramEvidence(pathTokens)) return true;
    if (/\/(diagram|schematic|figure|anatomy|infographic|flowchart)\b/i.test(path)) {
      return true;
    }
    // SVG with diagram-ish filename tokens.
    if (/\.svg(\?|$)/i.test(path) && /\b(fig|chart|map|cycle|flow|structure)\b/i.test(pathTokens)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function scoreDiagramImage(
  url: URL,
  evidenceText: string,
  topicKeys: string[],
): number {
  const host = url.hostname.toLowerCase();
  const pathTokens = decodePathTokens(url.pathname);
  const hay = `${evidenceText} ${pathTokens}`.toLowerCase();

  let score = 0;
  // Diagram-ness first.
  if (hasDiagramEvidence(hay)) score += 10;
  if (/\b(schematic|cross[- ]?section|labeled|labelled|flowchart|parts of)\b/i.test(hay)) {
    score += 4;
  }
  if (/\.svg(\?|$)/i.test(url.pathname)) score += 4;
  else if (/\.png(\?|$)/i.test(url.pathname)) score += 2;
  else if (/\.jpe?g(\?|$)/i.test(url.pathname)) score -= 1;

  // Relevance to the question — primary ranking signal.
  let topicHits = 0;
  for (const key of topicKeys) {
    if (key.length >= 3 && hay.includes(key)) topicHits += 1;
  }
  score += Math.min(12, topicHits * 4);
  if (topicKeys.length > 0 && topicHits === 0) score -= 10;

  // Tiny soft preference for known educational hosts (not a hard gate).
  if (PREFERRED_DOMAINS.some((d) => hostMatches(host, d))) score += 1;
  if (host.endsWith(".edu") || host.endsWith(".gov")) score += 1;

  if (PHOTO_REJECT.test(hay)) score -= 25;
  if (DIAGRAM_BLOCK_HOSTS.some((d) => hostMatches(host, d))) score -= 30;
  return score;
}

function topicTokensForDiagram(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(
      (w) =>
        w.length >= 3 &&
        !/^(the|and|for|with|how|what|why|does|diagram|image|picture|figure|show|explain|please|about|parts?)$/i.test(
          w,
        ),
    )
    .slice(0, 8);
}

type DiagramCandidate = {
  url: string;
  description: string;
  pageTitle?: string;
};

function collectImageCandidates(json: {
  images?: unknown;
  results?: Array<
    TavilyResult & { images?: unknown }
  >;
}): DiagramCandidate[] {
  const out: DiagramCandidate[] = [];

  const push = (raw: unknown, pageTitle?: string) => {
    if (typeof raw === "string") {
      out.push({ url: raw, description: "", pageTitle });
      return;
    }
    if (raw && typeof raw === "object") {
      const row = raw as { url?: unknown; description?: unknown };
      if (typeof row.url !== "string") return;
      out.push({
        url: row.url,
        description: cleanText(row.description, 240),
        pageTitle,
      });
    }
  };

  if (Array.isArray(json.images)) {
    for (const raw of json.images) push(raw);
  }
  for (const result of json.results ?? []) {
    const title = cleanText(result?.title, 160);
    if (Array.isArray(result.images)) {
      for (const raw of result.images) push(raw, title);
    }
    // Only keep result.url if it is itself an image asset with diagram evidence.
    if (typeof result?.url === "string") {
      push(result.url, title);
    }
  }
  return out;
}

async function fetchDiagramSearch(
  searchQuery: string,
  signal: AbortSignal,
  apiKey: string,
): Promise<{ images?: unknown; results?: Array<TavilyResult & { images?: unknown }> }> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: searchQuery,
      topic: "general",
      search_depth: "advanced",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
      include_images: true,
      include_image_descriptions: true,
      exclude_domains: [
        ...DIAGRAM_BLOCK_HOSTS,
        "pmc.ncbi.nlm.nih.gov",
        "pubmed.ncbi.nlm.nih.gov",
        "researchgate.net",
      ],
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Tavily diagram search failed with status ${response.status}`);
  }
  return (await response.json()) as {
    images?: unknown;
    results?: Array<TavilyResult & { images?: unknown }>;
  };
}

/**
 * Find a true labeled diagram/schematic image — not a generic photo.
 * Uses Tavily images + descriptions and hard diagram-evidence filters.
 */
export async function searchDiagramImageSources(
  query: string,
  signal?: AbortSignal,
): Promise<LessonSource[]> {
  const apiKey = getTavilyConfig().apiKey;
  const trimmed = query.trim().slice(0, 400);
  if (!apiKey || !trimmed) return [];

  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeout])
    : timeout;

  const topicKeys = topicTokensForDiagram(trimmed);
  const topicBit = topicKeys.slice(0, 4).join(" ") || trimmed;

  // Diagram + relevance only — not locked to a trusted-host allowlist.
  const queries = [
    `${topicBit} labeled diagram schematic "diagram" -photo -photograph -portrait`,
    `${topicBit} educational diagram labeled parts schematic -photo -stock`,
  ];

  const ranked: Array<LessonSource & { score: number }> = [];
  const seen = new Set<string>();

  for (const searchQuery of queries) {
    let json: Awaited<ReturnType<typeof fetchDiagramSearch>>;
    try {
      json = await fetchDiagramSearch(searchQuery, combinedSignal, apiKey);
    } catch {
      continue;
    }

    for (const candidate of collectImageCandidates(json)) {
      const url = safeUrl(candidate.url);
      if (!url || url.protocol !== "https:") continue;
      if (!isLikelyDiagramImageUrl(url.href)) continue;

      const evidence = [
        candidate.description,
        candidate.pageTitle || "",
        decodePathTokens(url.pathname),
      ]
        .filter(Boolean)
        .join(" ");

      // Absolute requirement: description/path/title must say it's a diagram.
      // SVG on edu/gov/wiki hosts may pass via isLikelyDiagramImageUrl alone,
      // but still prefer explicit evidence when present.
      const pathOk = hasDiagramEvidence(decodePathTokens(url.pathname));
      const textOk = hasDiagramEvidence(evidence);
      if (!pathOk && !textOk) continue;
      if (PHOTO_REJECT.test(evidence)) continue;

      if (seen.has(url.href)) continue;
      seen.add(url.href);

      const score = scoreDiagramImage(url, evidence, topicKeys);
      if (score < MIN_DIAGRAM_SCORE) continue;

      const titleBase =
        cleanText(candidate.description || candidate.pageTitle, 160) ||
        `Diagram: ${topicBit.slice(0, 80)}`;
      ranked.push({
        id: "tmp",
        title: titleBase.startsWith("Diagram")
          ? titleBase
          : `Diagram · ${titleBase}`,
        url: url.href,
        publisher: url.hostname.replace(/^www\./, ""),
        excerpt:
          cleanText(candidate.description, 400) ||
          "Relevant labeled diagram for this topic.",
        score,
      });
    }

    // If we already have a strong diagram, stop — don't dilute with weaker pass.
    if (ranked.some((r) => r.score >= MIN_DIAGRAM_SCORE + 4)) break;
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 3).map((item, index) => ({
    id: `D${index + 1}`,
    title: item.title,
    url: item.url,
    publisher: item.publisher,
    excerpt: item.excerpt,
  }));
}
