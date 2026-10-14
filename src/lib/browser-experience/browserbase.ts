import { Browserbase } from "@browserbasehq/sdk";
import { chromium } from "playwright-core";
import { getBrowserbaseConfig } from "@/lib/env";
import type { LiveBrowserHandle } from "@/lib/browser-experience/driver";

export function browserbaseConfigured(): boolean {
  return Boolean(getBrowserbaseConfig().apiKey);
}

export async function openBrowserbaseSession(): Promise<LiveBrowserHandle> {
  const { apiKey, projectId } = getBrowserbaseConfig();
  if (!apiKey) {
    throw new Error(
      "Add BROWSERBASE_API_KEY to enable the live cloud browser. On Vercel, local Chromium is not available.",
    );
  }

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({
    ...(projectId ? { projectId } : {}),
    browserSettings: {
      // Ad blocking breaks YouTube's player ("Something went wrong").
      blockAds: false,
      solveCaptchas: true,
      viewport: { width: 1280, height: 800 },
    },
    keepAlive: true,
    api_timeout: 3600,
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  let liveViewUrl: string | null = null;
  try {
    const debug = await bb.sessions.debug(session.id);
    liveViewUrl =
      debug.debuggerFullscreenUrl ||
      debug.debuggerUrl ||
      debug.pages?.[0]?.debuggerFullscreenUrl ||
      null;
  } catch {
    liveViewUrl = null;
  }

  return {
    provider: "browserbase",
    remoteSessionId: session.id,
    connectUrl: session.connectUrl,
    liveViewUrl,
    browser,
    page,
  };
}

export async function closeBrowserbaseRemote(sessionId: string): Promise<void> {
  const { apiKey } = getBrowserbaseConfig();
  if (!apiKey || !sessionId) return;
  try {
    const bb = new Browserbase({ apiKey });
    await bb.sessions.update(sessionId, { status: "REQUEST_RELEASE" });
  } catch {
    /* best-effort */
  }
}

/** Refresh the interactive debugger URL for human take-control. */
export async function refreshBrowserbaseLiveView(
  remoteSessionId: string,
): Promise<string | null> {
  const { apiKey } = getBrowserbaseConfig();
  if (!apiKey || !remoteSessionId) return null;
  try {
    const bb = new Browserbase({ apiKey });
    const debug = await bb.sessions.debug(remoteSessionId);
    return (
      debug.debuggerFullscreenUrl ||
      debug.debuggerUrl ||
      debug.pages?.[0]?.debuggerFullscreenUrl ||
      null
    );
  } catch {
    return null;
  }
}
