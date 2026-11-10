import { getTavilyConfig } from "@/lib/env";
import type { LessonSource } from "@/types/lesson";

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
};

type TavilyResponse = {
  results?: unknown;
};

const SEARCH_TIMEOUT_MS = 8_000;
const MAX_RESULTS = 5;
const SEARCH_CANDIDATES = 12;

const BLOCKED_DOMAINS = [
  "reddit.com",
  "wikipedia.org",
  "wikimedia.org",
  "quora.com",
  "medium.com",
  "substack.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "pinterest.com",
  "fandom.com",
] as const;

const TRUSTED_DOMAINS = [
  "acm.org",
  "apnews.com",
  "arxiv.org",
  "bbc.com",
  "britannica.com",
  "cambridge.org",
  "cdc.gov",
  "cern.ch",
  "doi.org",
  "developer.mozilla.org",
  "docs.oracle.com",
  "europa.eu",
  "ieee.org",
  "ipcc.ch",
  "jstor.org",
  "nature.com",
  "ncbi.nlm.nih.gov",
  "nejm.org",
  "nextjs.org",
  "nodejs.org",
  "noaa.gov",
  "oecd.org",
  "onlinelibrary.wiley.com",
  "openstax.org",
  "oxfordacademic.com",
  "pnas.org",
  "postgresql.org",
  "python.org",
  "react.dev",
  "rfc-editor.org",
  "reuters.com",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "link.springer.com",
  "tandfonline.com",
  "thelancet.com",
  "typescriptlang.org",
  "un.org",
  "w3.org",
  "who.int",
  "worldbank.org",
  "nasa.gov",
] as const;

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
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url;
  } catch {
    return null;
  }
}

function isDomainOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isCredibleSourceUrl(value: string | URL): boolean {
  const url = value instanceof URL ? value : safeUrl(value);
  if (!url || url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_DOMAINS.some((domain) => isDomainOrSubdomain(hostname, domain))) {
    return false;
  }
  if (
    hostname.endsWith(".edu") ||
    hostname.endsWith(".gov") ||
    /\.(?:ac|edu|gov)\.[a-z]{2}$/i.test(hostname)
  ) {
    return true;
  }
  return TRUSTED_DOMAINS.some((domain) =>
    isDomainOrSubdomain(hostname, domain),
  );
}

export function normalizeTavilyResults(value: unknown): LessonSource[] {
  const response = value as TavilyResponse;
  if (!Array.isArray(response?.results)) return [];

  const seen = new Set<string>();
  const sources: LessonSource[] = [];
  for (const raw of response.results as TavilyResult[]) {
    const url = safeUrl(raw?.url);
    const title = cleanText(raw?.title, 240);
    const excerpt = cleanText(raw?.content, 800);
    if (
      !url ||
      !isCredibleSourceUrl(url) ||
      !title ||
      !excerpt ||
      seen.has(url.href)
    ) {
      continue;
    }
    seen.add(url.href);
    sources.push({
      id: `S${sources.length + 1}`,
      title,
      url: url.href,
      publisher: url.hostname.replace(/^www\./, ""),
      excerpt,
    });
    if (sources.length >= MAX_RESULTS) break;
  }
  return sources;
}

export function formatWebEvidence(sources: LessonSource[]): string {
  if (!sources.length) return "";
  return sources
    .map(
      (source) =>
        `[${source.id}] ${source.title}\nPublisher: ${source.publisher}\nURL: ${source.url}\nExcerpt: ${source.excerpt}`,
    )
    .join("\n\n");
}

export async function searchLessonSources(
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

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `${trimmed} peer-reviewed research official university government`,
      topic: "general",
      search_depth: "advanced",
      chunks_per_source: 2,
      max_results: SEARCH_CANDIDATES,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      exclude_domains: [...BLOCKED_DOMAINS],
    }),
    signal: combinedSignal,
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }
  return normalizeTavilyResults(await response.json());
}

export type TopicBriefing = {
  answer: string;
  sources: LessonSource[];
};

/**
 * Fast, general web lookup for "what is this, right now?" grounding — product
 * launches, recent events, new terms the model may not know. Unlike
 * searchLessonSources it does not restrict to academic domains (news and
 * official vendor sites are what matter here); only low-signal domains are
 * dropped.
 */
export async function searchTopicBriefing(
  query: string,
  signal?: AbortSignal,
  timeoutMs = 6_000,
): Promise<TopicBriefing> {
  const apiKey = getTavilyConfig().apiKey;
  const trimmed = query.trim().slice(0, 400);
  if (!apiKey || !trimmed) return { answer: "", sources: [] };

  const timeout = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: trimmed,
      topic: "general",
      search_depth: "basic",
      max_results: 6,
      include_answer: "basic",
      include_raw_content: false,
      include_images: false,
      exclude_domains: [...BLOCKED_DOMAINS],
    }),
    signal: combinedSignal,
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }
  const json = (await response.json()) as TavilyResponse & { answer?: unknown };
  const seen = new Set<string>();
  const sources: LessonSource[] = [];
  for (const raw of Array.isArray(json.results)
    ? (json.results as TavilyResult[])
    : []) {
    const url = safeUrl(raw?.url);
    const title = cleanText(raw?.title, 240);
    const excerpt = cleanText(raw?.content, 600);
    if (!url || !title || !excerpt || seen.has(url.href)) continue;
    if (
      BLOCKED_DOMAINS.some((domain) => isDomainOrSubdomain(url.hostname, domain))
    ) {
      continue;
    }
    seen.add(url.href);
    sources.push({
      id: `S${sources.length + 1}`,
      title,
      url: url.href,
      publisher: url.hostname,
      excerpt,
    });
    if (sources.length >= MAX_RESULTS) break;
  }
  return { answer: cleanText(json.answer, 1_200), sources };
}

/** Wire-service and major-outlet hosts preferred for News mode. */
export const NEWS_PREFERRED_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "ap.org",
  "bbc.com",
  "bbc.co.uk",
  "npr.org",
  "theguardian.com",
  "nytimes.com",
  "washingtonpost.com",
  "wsj.com",
  "bloomberg.com",
  "ft.com",
  "economist.com",
  "cnn.com",
  "aljazeera.com",
  "politico.com",
  "axios.com",
  "nature.com",
  "science.org",
  "nasa.gov",
  "who.int",
  "cdc.gov",
  "noaa.gov",
  "federalreserve.gov",
  "sec.gov",
  "treasury.gov",
] as const;

/** Image CDNs / hosts commonly used by those outlets. */
const NEWS_IMAGE_HOSTS = [
  ...NEWS_PREFERRED_DOMAINS,
  "bbci.co.uk",
  "ichef.bbci.co.uk",
  "static.bbc.co.uk",
  "reutersmedia.net",
  "static01.nyt.com",
  "static.nytimes.com",
  "nyt.com",
  "guim.co.uk",
  "media.guim.co.uk",
  "assets.bwbx.io",
  "cdn.cnn.com",
  "media.cnn.com",
  "i.cdn.turner.com",
  "video-api.wsj.com",
  "images.wsj.net",
  "s.wsj.net",
  "img.washingtonpost.com",
  "www3.nhk.or.jp",
] as const;

export function isNewsPreferredHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return NEWS_PREFERRED_DOMAINS.some((domain) =>
    isDomainOrSubdomain(host, domain),
  );
}

export function isNewsImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (isNewsPreferredHost(host)) return true;
  return NEWS_IMAGE_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function newsSourceScore(url: URL): number {
  const host = url.hostname.toLowerCase();
  if (isNewsPreferredHost(host)) return 0;
  if (host.endsWith(".gov") || /\.(?:ac|edu|gov)\.[a-z]{2}$/i.test(host)) {
    return 1;
  }
  return 2;
}

function collectBriefingSources(value: unknown): LessonSource[] {
  const response = value as TavilyResponse;
  if (!Array.isArray(response?.results)) return [];
  const seen = new Set<string>();
  const sources: LessonSource[] = [];
  for (const raw of response.results as TavilyResult[]) {
    const url = safeUrl(raw?.url);
    const title = cleanText(raw?.title, 240);
    const excerpt = cleanText(raw?.content, 700);
    if (!url || !title || !excerpt || seen.has(url.href)) continue;
    if (
      BLOCKED_DOMAINS.some((domain) => isDomainOrSubdomain(url.hostname, domain))
    ) {
      continue;
    }
    seen.add(url.href);
    sources.push({
      id: `S${sources.length + 1}`,
      title,
      url: url.href,
      publisher: url.hostname.replace(/^www\./, ""),
      excerpt,
    });
  }
  return sources
    .sort((a, b) => {
      const aUrl = safeUrl(a.url);
      const bUrl = safeUrl(b.url);
      return (
        newsSourceScore(aUrl ?? new URL("https://example.com")) -
        newsSourceScore(bUrl ?? new URL("https://example.com"))
      );
    })
    .slice(0, MAX_RESULTS)
    .map((source, index) => ({ ...source, id: `S${index + 1}` }));
}

/**
 * Current-events briefing for News mode. Prefers wire services and major
 * outlets via Tavily's news topic; falls back to an open news search when the
 * preferred-domain pass returns nothing.
 */
export async function searchNewsBriefing(
  query: string,
  signal?: AbortSignal,
  timeoutMs = 8_000,
): Promise<TopicBriefing> {
  const apiKey = getTavilyConfig().apiKey;
  const trimmed = query.trim().slice(0, 320);
  if (!apiKey || !trimmed) return { answer: "", sources: [] };

  const today = new Date().toISOString().slice(0, 10);
  // Force recency in the query — bare "nasdaq" otherwise ranks archival explainers.
  const datedQuery = `${trimmed} today ${today} latest`.slice(0, 400);

  const timeout = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  async function run(includeDomains: boolean): Promise<TopicBriefing> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: datedQuery,
        topic: "news",
        search_depth: "advanced",
        max_results: 8,
        include_answer: "advanced",
        include_raw_content: false,
        include_images: false,
        exclude_domains: [
          ...BLOCKED_DOMAINS,
          "wikipedia.org",
          "wikimedia.org",
        ],
        ...(includeDomains
          ? { include_domains: [...NEWS_PREFERRED_DOMAINS] }
          : {}),
      }),
      signal: combinedSignal,
    });
    if (!response.ok) {
      throw new Error(`Tavily news search failed with status ${response.status}`);
    }
    const json = (await response.json()) as TavilyResponse & { answer?: unknown };
    return {
      answer: cleanText(json.answer, 1_400),
      sources: collectBriefingSources(json),
    };
  }

  try {
    const preferred = await run(true);
    if (preferred.answer || preferred.sources.length) return preferred;
  } catch (error) {
    console.warn(
      "[tavily] preferred news search failed",
      error instanceof Error ? error.message : "search failed",
    );
  }
  return run(false);
}

