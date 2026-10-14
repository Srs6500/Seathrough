import type { LessonSource } from "@/types/lesson";
import type {
  BrowserTabKind,
  BrowserTabPublic,
} from "@/lib/browser-experience/types";

export function faviconForUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (!host || host === "about" || url.startsWith("about:")) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  } catch {
    return null;
  }
}

export function tabTitleFrom(
  title: string | null | undefined,
  url: string,
  fallback = "New Tab",
): string {
  const cleaned = (title || "").replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned.slice(0, 80);
  try {
    const parsed = new URL(url);
    if (parsed.hostname) return parsed.hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  if (url && url !== "about:blank") return url.slice(0, 48);
  return fallback;
}

export function toPublicTab(tab: {
  id: string;
  title: string;
  url: string;
  faviconUrl: string | null;
  kind: BrowserTabKind;
  role: "ground" | "truth" | null;
  source: LessonSource | null;
}): BrowserTabPublic {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    faviconUrl: tab.faviconUrl,
    kind: tab.kind,
    role: tab.role,
    sourceId: tab.source?.id ?? null,
  };
}

export function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "browser";
  } catch {
    return "browser";
  }
}

/**
 * Muse-style omnibox: URL → open it; otherwise Google-search the query.
 */
export function resolveOmniboxTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "https://www.google.com/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^about:/i.test(trimmed)) return trimmed;
  // Bare host / path without spaces → treat as URL.
  if (
    /^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed) &&
    !/\s/.test(trimmed)
  ) {
    return `https://${trimmed}`;
  }
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("hl", "en");
  return url.href;
}
