import { chromium, type CDPSession, type Page } from "playwright-core";
import { getBrowserlessConfig } from "@/lib/env";
import type { LiveBrowserHandle } from "@/lib/browser-experience/driver";

const DEFAULT_HOST = "wss://production-sfo.browserless.io";

/** Reuse one CDP session per page — repeated newCDPSession triggers Duplicate target. */
const cdpByPage = new WeakMap<Page, CDPSession>();

export function browserlessConfigured(): boolean {
  return Boolean(getBrowserlessConfig().apiKey);
}

/**
 * Stealth Chromium reduces “browser not secure” / bot walls vs plain CDP.
 * If BROWSERLESS_WS_ENDPOINT already includes a path, we keep it.
 */
function connectUrl(apiKey: string, endpoint: string): string {
  let base = endpoint.replace(/\/$/, "");
  if (!base.includes("://")) base = `wss://${base}`;
  const url = new URL(base);
  const path = url.pathname.replace(/\/$/, "");
  if (!path || path === "/") {
    url.pathname = "/chromium/stealth";
  }
  url.searchParams.set("token", apiKey);
  url.searchParams.set("solveCaptchas", "true");
  url.searchParams.set("blockAds", "false");
  return url.toString();
}

async function pageCdp(page: Page): Promise<CDPSession> {
  const existing = cdpByPage.get(page);
  if (existing) return existing;
  const cdp = await page.context().newCDPSession(page);
  cdpByPage.set(page, cdp);
  return cdp;
}

/**
 * Mint an embeddable LiveURL for human take-control only.
 * Do NOT pass instructions (Done modal closes the stream → blank/"All done").
 */
export async function mintLiveViewUrl(page: Page): Promise<string | null> {
  try {
    const cdp = await pageCdp(page);
    const result = (await (cdp as unknown as {
      send: (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<{ liveURL?: string; error?: string }>;
    }).send("Browserless.liveURL", {
      timeout: 120_000,
      interactable: true,
      showBrowserInterface: false,
      resizable: false,
      quality: 72,
      instructions: "",
    })) as { liveURL?: string; error?: string };

    if (result?.liveURL) return result.liveURL;
    if (result?.error) {
      console.warn("[browserless] liveURL unavailable:", result.error);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Duplicate target|Assertion error/i.test(message)) {
      console.warn("[browserless] liveURL failed:", message);
    }
  }
  return null;
}

export async function openBrowserlessSession(): Promise<LiveBrowserHandle> {
  const { apiKey, wsEndpoint } = getBrowserlessConfig();
  if (!apiKey) {
    throw new Error(
      "Add BROWSERLESS_API_KEY to enable Browserless cloud browser sessions.",
    );
  }

  const endpoint = wsEndpoint || DEFAULT_HOST;
  const ws = connectUrl(apiKey, endpoint);
  const browser = await chromium.connectOverCDP(ws);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  // Do NOT mint LiveURL here. Early mint expires in 120s and shows "All done"
  // before the user needs Take control. Agent theater uses frame stream until then.
  return {
    provider: "browserless",
    connectUrl: `${endpoint}?token=***`,
    liveViewUrl: null,
    browser,
    page,
  };
}
