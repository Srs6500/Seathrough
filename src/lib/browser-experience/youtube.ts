import type { Page } from "playwright-core";
import { isGoogleAuthUrl } from "@/lib/browser-experience/challenge";
import { getTavilyConfig } from "@/lib/env";
import type { LessonSource } from "@/types/lesson";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const YOUTUBE_ASK =
  /\b(youtube|yt\b|video|watch|clip|lecture recording|ted talk)\b/i;

const TRUSTED_CHANNEL_HINTS = [
  "khan academy",
  "crash course",
  "amoeba sisters",
  "ted-ed",
  "ted ed",
  "national geographic",
  "bozeman",
  "mit opencourseware",
  "kurzgesagt",
  "veritasium",
  "scishow",
  "free school",
  "nucleus medical",
  "osmosis",
  "crashcourse",
];

export function wantsYouTube(question: string): boolean {
  return YOUTUBE_ASK.test(question);
}

export function isYouTubeWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return u.pathname.length > 1;
    if (host === "youtube.com" || host === "m.youtube.com") {
      return u.pathname === "/watch" && u.searchParams.has("v");
    }
    return false;
  } catch {
    return false;
  }
}

export function isYouTubeEmbedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return (
      (host === "youtube.com" ||
        host === "youtube-nocookie.com" ||
        host === "m.youtube.com") &&
      u.pathname.startsWith("/embed/")
    );
  } catch {
    return false;
  }
}

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return u.pathname.replace(/^\//, "").slice(0, 20) || null;
    }
    if (host.includes("youtube")) {
      if (u.pathname.startsWith("/embed/")) {
        return u.pathname.split("/")[2]?.slice(0, 20) || null;
      }
      return u.searchParams.get("v");
    }
    return null;
  } catch {
    return null;
  }
}

export function watchUrlForId(id: string, seconds = 0): string {
  const t = Math.max(0, Math.floor(seconds));
  const base = `https://www.youtube.com/watch?v=${id}`;
  return t > 0 ? `${base}&t=${t}s` : base;
}

export function embedUrlForId(id: string, seconds = 0): string {
  const t = Math.max(0, Math.floor(seconds));
  // youtube.com embed (not nocookie) — fewer Error 153 config failures in automation.
  const url = new URL(`https://www.youtube.com/embed/${id}`);
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("rel", "0");
  url.searchParams.set("modestbranding", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("autoplay", "1");
  if (t > 0) url.searchParams.set("start", String(t));
  return url.href;
}

export function watchUrlWithTime(url: string, seconds: number): string {
  const id = extractYouTubeId(url);
  if (!id) return url;
  if (isYouTubeEmbedUrl(url)) return embedUrlForId(id, seconds);
  return watchUrlForId(id, seconds);
}

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function educationalBoost(title: string, excerpt: string): number {
  const hay = `${title} ${excerpt}`.toLowerCase();
  let boost = 0;
  for (const hint of TRUSTED_CHANNEL_HINTS) {
    if (hay.includes(hint)) boost += 25;
  }
  if (/\b(explained|crash course|lecture|science|biology|physics|chemistry)\b/i.test(hay)) {
    boost += 8;
  }
  // Prefer shorter educational clips over multi-hour "full chapter" dumps.
  if (/\b(full chapter|complete course|playlist|10 hours|hour long)\b/i.test(hay)) {
    boost -= 15;
  }
  return boost;
}

/** Search specifically for educational YouTube videos. */
export async function searchYouTubeSources(
  query: string,
  signal?: AbortSignal,
): Promise<LessonSource[]> {
  const apiKey = getTavilyConfig().apiKey;
  const trimmed = query
    .replace(/\b(youtube|yt|video|watch)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  if (!apiKey || !trimmed) return [];

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `${trimmed} explained site:youtube.com (Khan Academy OR Crash Course OR Amoeba Sisters OR TED-Ed OR Bozeman)`,
      topic: "general",
      search_depth: "advanced",
      max_results: 12,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
    signal: signal ?? AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }

  const json = (await response.json()) as { results?: TavilyResult[] };
  const scored: Array<LessonSource & { rank: number }> = [];
  const seen = new Set<string>();

  for (const raw of json.results ?? []) {
    const urlRaw = typeof raw.url === "string" ? raw.url : "";
    if (!isYouTubeWatchUrl(urlRaw) && !isYouTubeEmbedUrl(urlRaw)) continue;
    const id = extractYouTubeId(urlRaw);
    if (!id || seen.has(id)) continue;
    const title = cleanText(raw.title, 240);
    const excerpt = cleanText(raw.content, 800);
    if (!title) continue;
    seen.add(id);
    scored.push({
      id: `Y${scored.length + 1}`,
      title,
      url: watchUrlForId(id),
      publisher: "youtube.com",
      excerpt: excerpt || title,
      rank: educationalBoost(title, excerpt),
    });
  }

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, 6).map(({ rank: _rank, ...source }) => source);
}

async function dismissYouTubeOverlays(page: Page): Promise<void> {
  const selectors = [
    "button:has-text('Accept all')",
    "button:has-text('Accept the use of cookies')",
    "button:has-text('I agree')",
    "button:has-text('Reject all')",
    "button:has-text('No thanks')",
    "tp-yt-paper-button:has-text('Accept all')",
    "[aria-label='Accept the use of cookies and other data for the purposes described']",
  ];
  for (const selector of selectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 700 }).catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => undefined);
      await delay(400);
    }
  }
}

export async function youtubePlayerError(
  page: Page,
): Promise<string | null> {
  return page.evaluate(() => {
    const errorRoot = document.querySelector(
      ".ytp-error, .ytp-error-content, #player-error-message-container, .player-unavailable",
    );
    const text = (errorRoot?.textContent || "").replace(/\s+/g, " ").trim();
    if (/error\s*153|video player configuration error/i.test(text)) {
      return "Error 153";
    }
    if (
      /something went wrong|error|unavailable|not available|copyright|sign in to confirm/i.test(
        text,
      )
    ) {
      return text.slice(0, 200) || "player_error";
    }
    const body = (document.body?.innerText || "").slice(0, 1600);
    if (/error\s*153|video player configuration error/i.test(body)) {
      return "Error 153";
    }
    if (/something went wrong\.?\s*refresh or try again/i.test(body)) {
      return "Something went wrong";
    }
    if (/sign in to confirm you.?re not a bot/i.test(body)) {
      return "sign_in_bot";
    }
    return null;
  });
}

/** Click YouTube’s “Watch on YouTube” escape hatch (Error 153 / embed walls). */
export async function clickWatchOnYouTube(page: Page): Promise<boolean> {
  const selectors = [
    'a:has-text("Watch on YouTube")',
    'button:has-text("Watch on YouTube")',
    'a:has-text("Watch video on YouTube")',
    'button:has-text("Watch video on YouTube")',
    'a[href*="youtube.com/watch"]',
    'yt-button-shape a:has-text("Watch")',
  ];
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 900 }).catch(() => false)) {
      await el.click({ timeout: 4000 }).catch(() => undefined);
      await delay(1600);
      return true;
    }
  }
  // Text fallback via evaluate + click
  const clicked = await page
    .evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll("a, button, yt-button-shape"),
      );
      for (const node of nodes) {
        const label = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (/watch (video )?on youtube/i.test(label)) {
          (node as HTMLElement).click();
          return true;
        }
      }
      return false;
    })
    .catch(() => false);
  if (clicked) await delay(1600);
  return clicked;
}

export async function youtubeHasPlayableMedia(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const video = document.querySelector("video");
    if (!video) return false;
    const ready = video.readyState >= 2 || video.duration > 0 || !video.paused;
    const rect = video.getBoundingClientRect();
    return ready && rect.width > 40 && rect.height > 40;
  });
}

async function tryPlayable(
  page: Page,
): Promise<{ ok: boolean; err: string | null }> {
  await dismissYouTubeOverlays(page);
  const err = await youtubePlayerError(page);
  if (err === "sign_in_bot" || isGoogleAuthUrl(page.url())) {
    return { ok: false, err: err || "google_auth" };
  }
  if (err) return { ok: false, err };
  await youtubePlay(page);
  await delay(900);
  if (await youtubeHasPlayableMedia(page)) return { ok: true, err: null };
  await youtubePlay(page);
  await delay(700);
  if (await youtubeHasPlayableMedia(page)) return { ok: true, err: null };
  const again = await youtubePlayerError(page);
  return { ok: false, err: again || "no_playable_media" };
}

/**
 * Open a YouTube lesson for Ground.
 * Prefer the watch page (real feed + Take-control path for Error 153 / bot sign-in).
 * On Error 153, click “Watch on YouTube” once, then fall back to embed.
 */
export async function openYouTubeLesson(
  page: Page,
  watchUrl: string,
): Promise<{
  ok: boolean;
  mode: "watch" | "embed";
  url: string;
  reason?: string;
  needsHuman?: boolean;
}> {
  const id = extractYouTubeId(watchUrl);
  if (!id) return { ok: false, mode: "watch", url: watchUrl, reason: "bad_id" };

  const watch = watchUrlForId(id);
  const embed = embedUrlForId(id);

  // 1) Watch page first — matches the product path users already fight through.
  try {
    await page.setExtraHTTPHeaders({
      Referer: "https://www.youtube.com/",
      "Accept-Language": "en-US,en;q=0.9",
    });
    await page.goto(watch, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await delay(1200);

    if (isGoogleAuthUrl(page.url())) {
      return {
        ok: false,
        mode: "watch",
        url: page.url(),
        reason: "google_auth",
        needsHuman: true,
      };
    }

    let attempt = await tryPlayable(page);
    if (attempt.ok) {
      return { ok: true, mode: "watch", url: page.url() };
    }

    // Error 153 / config error → click Watch on YouTube once, else hand to human.
    if (
      attempt.err === "Error 153" ||
      /configuration error/i.test(attempt.err || "")
    ) {
      const clicked = await clickWatchOnYouTube(page);
      if (clicked) {
        await delay(1200);
        if (isGoogleAuthUrl(page.url())) {
          return {
            ok: false,
            mode: "watch",
            url: page.url(),
            reason: "google_auth",
            needsHuman: true,
          };
        }
        attempt = await tryPlayable(page);
        if (attempt.ok) {
          return { ok: true, mode: "watch", url: page.url() };
        }
      }
      return {
        ok: false,
        mode: "watch",
        url: page.url(),
        reason: "Error 153",
        needsHuman: true,
      };
    }

    if (
      attempt.err === "sign_in_bot" ||
      attempt.err === "google_auth" ||
      isGoogleAuthUrl(page.url())
    ) {
      return {
        ok: false,
        mode: "watch",
        url: page.url(),
        reason: attempt.err || "sign_in_bot",
        needsHuman: true,
      };
    }
  } catch {
    /* try embed */
  }

  // 2) Embed fallback
  try {
    await page.goto(embed, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await delay(1200);
    if (isGoogleAuthUrl(page.url())) {
      return {
        ok: false,
        mode: "embed",
        url: page.url(),
        reason: "google_auth",
        needsHuman: true,
      };
    }
    const attempt = await tryPlayable(page);
    if (attempt.ok) {
      return { ok: true, mode: "embed", url: page.url() };
    }
    if (
      attempt.err === "Error 153" ||
      /configuration error/i.test(attempt.err || "")
    ) {
      await clickWatchOnYouTube(page);
      await delay(1200);
      const again = await tryPlayable(page);
      if (again.ok) {
        return { ok: true, mode: "watch", url: page.url() };
      }
      if (again.err === "sign_in_bot" || isGoogleAuthUrl(page.url())) {
        return {
          ok: false,
          mode: "watch",
          url: page.url(),
          reason: again.err || "sign_in_bot",
          needsHuman: true,
        };
      }
    }
    return {
      ok: false,
      mode: "embed",
      url: page.url(),
      reason: attempt.err || "no_playable_media",
      needsHuman:
        attempt.err === "sign_in_bot" || attempt.err === "google_auth",
    };
  } catch (error) {
    return {
      ok: false,
      mode: "embed",
      url: embed,
      reason: error instanceof Error ? error.message : "embed_failed",
    };
  }
}

export async function youtubePlay(page: Page): Promise<{ ok: boolean; reason?: string }> {
  try {
    await dismissYouTubeOverlays(page);

    const playBtn = page.locator(
      [
        "button.ytp-large-play-button",
        "button.ytp-play-button[data-title-no-tooltip='Play']",
        "button.ytp-play-button[aria-label^='Play']",
        ".ytp-cued-thumbnail-overlay-image",
        "button[aria-label='Play']",
      ].join(", "),
    );
    if (await playBtn.first().isVisible({ timeout: 1800 }).catch(() => false)) {
      await playBtn.first().click({ timeout: 3000 }).catch(() => undefined);
    }

    await page.evaluate(async () => {
      const video = document.querySelector("video");
      if (!video) return;
      try {
        video.muted = true; // muted autoplay is allowed in headless/cloud browsers
        await video.play();
      } catch {
        /* click path above is the main gesture */
      }
    });

    await page.locator("video").first().waitFor({ state: "attached", timeout: 8000 });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "play_failed",
    };
  }
}

export async function youtubePause(page: Page): Promise<{ ok: boolean; reason?: string }> {
  try {
    await page.evaluate(() => {
      const video = document.querySelector("video");
      if (video) video.pause();
    });
    const pauseBtn = page.locator(
      "button.ytp-play-button[data-title-no-tooltip='Pause'], button.ytp-play-button[aria-label^='Pause']",
    );
    if (await pauseBtn.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await pauseBtn.first().click({ timeout: 1500 }).catch(() => undefined);
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "pause_failed",
    };
  }
}

export async function youtubeSeek(
  page: Page,
  seconds: number,
): Promise<{ ok: boolean; reason?: string; mode?: string }> {
  const t = Math.max(0, Math.floor(seconds));
  try {
    const sought = await page.evaluate(async (time) => {
      const video = document.querySelector("video");
      if (!video) return false;
      video.pause();
      try {
        video.currentTime = time;
      } catch {
        return false;
      }
      await new Promise((r) => setTimeout(r, 280));
      video.pause();
      return true;
    }, t);

    if (sought) {
      await youtubePause(page);
      return { ok: true, mode: "youtube_seek" };
    }

    const current = page.url();
    const id = extractYouTubeId(current);
    if (!id) return { ok: false, reason: "no_video_id" };
    const next = isYouTubeEmbedUrl(current)
      ? embedUrlForId(id, t)
      : watchUrlForId(id, t);
    await page.goto(next, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await delay(1200);
    await youtubePlay(page);
    await delay(700);
    await youtubePause(page);
    return { ok: true, mode: "youtube_seek_nav" };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "seek_failed",
    };
  }
}

export async function extractYouTubeMeta(page: Page): Promise<{
  title: string;
  url: string;
  durationSec: number | null;
}> {
  return page.evaluate(() => {
    const title =
      document
        .querySelector(
          "h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string, h1, .ytp-title-link",
        )
        ?.textContent?.trim() ||
      document.title.replace(/ - YouTube$/i, "").trim() ||
      "";
    const video = document.querySelector("video");
    const durationSec =
      video && Number.isFinite(video.duration) && video.duration > 0
        ? Math.floor(video.duration)
        : null;
    return { title, url: location.href, durationSec };
  });
}
