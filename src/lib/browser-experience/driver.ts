import type { Browser, Page } from "playwright-core";
import type { AnnotateResult } from "@/lib/browser-experience/annotateScript";
import { ANNOTATE_BOOTSTRAP } from "@/lib/browser-experience/annotateScript";
import type {
  BrowserAnnotation,
  BrowserProvider,
} from "@/lib/browser-experience/types";
import {
  youtubePause,
  youtubePlay,
  youtubeSeek,
} from "@/lib/browser-experience/youtube";

export type LiveBrowserHandle = {
  provider: BrowserProvider;
  /** Browserbase session id when provider is browserbase. */
  remoteSessionId?: string;
  connectUrl?: string;
  liveViewUrl: string | null;
  browser: Browser;
  page: Page;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isContextDestroyedError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /Execution context was destroyed|Target closed|Frame was detached|most likely because of a navigation|Cannot find context with specified id/i.test(
    message,
  );
}

/** Wait until the document is usable after goto / redirects. */
export async function waitForStablePage(
  page: Page,
  options?: { settleMs?: number; timeoutMs?: number },
): Promise<void> {
  const timeout = options?.timeoutMs ?? 20_000;
  const settleMs = options?.settleMs ?? 450;

  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
  await page.waitForLoadState("load", { timeout: Math.min(timeout, 12_000) }).catch(
    () => undefined,
  );

  // Absorb common client-side redirects (Google, cookie walls, www → apex).
  let previous = "";
  for (let i = 0; i < 6; i += 1) {
    const current = page.url();
    if (current && current === previous && !current.startsWith("about:")) break;
    previous = current;
    await delay(settleMs);
    await page
      .waitForLoadState("domcontentloaded", { timeout: 5_000 })
      .catch(() => undefined);
  }

  await page
    .waitForFunction(
      () =>
        document.readyState === "interactive" ||
        document.readyState === "complete",
      { timeout: 8_000 },
    )
    .catch(() => undefined);
}

export async function gotoSafe(
  page: Page,
  url: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeout = options?.timeoutMs ?? 45_000;
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
  } catch (error) {
    // Some sites navigate away during goto; if we landed somewhere, continue.
    if (!isContextDestroyedError(error) && !page.url()) throw error;
  }
  await waitForStablePage(page, { timeoutMs: Math.min(timeout, 20_000) });
}

async function evaluateWithRetry<T>(
  page: Page,
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await waitForStablePage(page, {
        settleMs: attempt === 0 ? 200 : 500,
        timeoutMs: 12_000,
      });
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isContextDestroyedError(error) || attempt === attempts - 1) {
        throw error;
      }
      await delay(350 + attempt * 250);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not run script on the page.");
}

export async function ensureAnnotateApi(page: Page): Promise<void> {
  await evaluateWithRetry(page, async () => {
    await page.evaluate(ANNOTATE_BOOTSTRAP);
  });
}

export async function applyAnnotation(
  page: Page,
  annotation: BrowserAnnotation,
): Promise<AnnotateResult> {
  if (annotation.kind === "youtube_play") {
    const result = await youtubePlay(page);
    await delay(900);
    return result;
  }
  if (annotation.kind === "youtube_pause") {
    const result = await youtubePause(page);
    await delay(400);
    return result;
  }
  if (annotation.kind === "youtube_seek") {
    const result = await youtubeSeek(page, annotation.seconds ?? 0);
    await delay(900);
    return result;
  }

  const result = await evaluateWithRetry(page, async () => {
    await page.evaluate(ANNOTATE_BOOTSTRAP);
    return (await page.evaluate((payload) => {
      const api = (
        window as unknown as {
          __seethroughBrowser?: {
            apply: (a: BrowserAnnotation) => AnnotateResult;
          };
        }
      ).__seethroughBrowser;
      if (!api) return { ok: false, reason: "api_missing" };
      return api.apply(payload);
    }, annotation)) as AnnotateResult;
  });

  if (annotation.kind === "click" && result.ok) {
    await page
      .waitForLoadState("domcontentloaded", { timeout: 12_000 })
      .catch(() => undefined);
    await delay(900);
    await waitForStablePage(page, { settleMs: 400, timeoutMs: 12_000 }).catch(
      () => undefined,
    );
    return result;
  }

  // Let smooth-scroll + cursor glide finish before the next screenshot/speech.
  if (annotation.kind !== "clear") {
    await delay(
      result.mode === "figure_hotspot" || result.mode === "click" ? 950 : 800,
    );
  }
  return result;
}

export type PageExtraction = {
  title: string;
  url: string;
  text: string;
  /** Visible headings / labels the tutor can point at. */
  anchors: string[];
  hasLargeFigure: boolean;
};

export async function extractPageText(
  page: Page,
  maxChars = 12_000,
): Promise<PageExtraction> {
  return evaluateWithRetry(page, async () => {
    return page.evaluate((limit) => {
      const title = document.title || "";
      const url = location.href;
      const root =
        document.querySelector("article") ||
        document.querySelector("main") ||
        document.body;
      const raw = (root?.innerText || "").replace(/\s+/g, " ").trim();
      const anchors: string[] = [];
      const seen = new Set<string>();
      const push = (value: string) => {
        const cleaned = value.replace(/\s+/g, " ").trim();
        if (cleaned.length < 3 || cleaned.length > 80) return;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        anchors.push(cleaned);
      };
      for (const el of Array.from(
        document.querySelectorAll(
          [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "figcaption",
            "dt",
            "th",
            "strong",
            "b",
            "summary",
            "label",
            "[aria-label]",
            ".mw-headline",
            "li > a",
            "p > strong",
            "p > b",
          ].join(","),
        ),
      )) {
        const aria = el.getAttribute("aria-label");
        push(aria || (el.textContent || "").trim());
        if (anchors.length >= 56) break;
      }
      // First short paragraph lines often highlight better than long body dumps.
      for (const p of Array.from(document.querySelectorAll("p")).slice(0, 12)) {
        const line = (p.textContent || "").replace(/\s+/g, " ").trim();
        if (line.length >= 12 && line.length <= 72) push(line);
        else if (line.length > 72) {
          const cut = line.split(/(?<=[,;:])\s+/).find((s) => s.length >= 12 && s.length <= 72);
          if (cut) push(cut);
        }
        if (anchors.length >= 56) break;
      }
      for (const img of Array.from(document.querySelectorAll("img[alt]"))) {
        push(img.getAttribute("alt") || "");
      }
      const imgs = Array.from(
        document.querySelectorAll("figure img, article img, main img, img"),
      );
      const hasLargeFigure = imgs.some((img) => {
        const r = img.getBoundingClientRect();
        return r.width >= 160 && r.height >= 120;
      });
      return {
        title,
        url,
        text: raw.slice(0, limit),
        anchors,
        hasLargeFigure,
      };
    }, maxChars);
  });
}

export async function screenshotJpeg(
  page: Page,
  quality = 62,
): Promise<Buffer> {
  return evaluateWithRetry(page, async () => {
    return page.screenshot({
      type: "jpeg",
      quality,
      fullPage: false,
    });
  });
}

export async function closeHandle(handle: LiveBrowserHandle): Promise<void> {
  try {
    await handle.page.close().catch(() => undefined);
  } catch {
    /* ignore */
  }
  try {
    await handle.browser.close().catch(() => undefined);
  } catch {
    /* ignore */
  }
}
