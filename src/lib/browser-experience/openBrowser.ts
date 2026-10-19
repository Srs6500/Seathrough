import {
  browserbaseConfigured,
  openBrowserbaseSession,
} from "@/lib/browser-experience/browserbase";
import {
  browserlessConfigured,
  openBrowserlessSession,
} from "@/lib/browser-experience/browserless";
import type { LiveBrowserHandle } from "@/lib/browser-experience/driver";
import {
  isServerlessHost,
  localPlaywrightAllowed,
} from "@/lib/browser-experience/host";
import { openLocalBrowserSession } from "@/lib/browser-experience/playwrightLocal";

export {
  isServerlessHost,
  localPlaywrightAllowed,
} from "@/lib/browser-experience/host";

export type PreferredBrowserProvider =
  | "browserless"
  | "browserbase"
  | "local"
  | "none";

/**
 * Phase 0: on a normal machine, prefer local Chromium (headed Take control)
 * unless BROWSER_EXPERIENCE_PROVIDER forces a cloud provider.
 * Serverless always needs Browserless/Browserbase.
 */
export function preferredBrowserProvider(): PreferredBrowserProvider {
  const forced = (
    process.env.BROWSER_EXPERIENCE_PROVIDER || ""
  )
    .toLowerCase()
    .trim();

  if (forced === "local") {
    if (localPlaywrightAllowed()) return "local";
    if (browserlessConfigured()) return "browserless";
    if (browserbaseConfigured()) return "browserbase";
    return "none";
  }
  if (forced === "browserless") {
    if (browserlessConfigured()) return "browserless";
    if (browserbaseConfigured()) return "browserbase";
    if (localPlaywrightAllowed()) return "local";
    return "none";
  }
  if (forced === "browserbase") {
    if (browserbaseConfigured()) return "browserbase";
    if (browserlessConfigured()) return "browserless";
    if (localPlaywrightAllowed()) return "local";
    return "none";
  }

  // auto / unset — local-first when Chromium can launch (Phase 0).
  if (localPlaywrightAllowed()) return "local";
  if (browserlessConfigured()) return "browserless";
  if (browserbaseConfigured()) return "browserbase";
  return "none";
}

async function openCloudBrowser(
  prefer: "browserless" | "browserbase" | "auto" = "auto",
): Promise<LiveBrowserHandle | null> {
  if (prefer === "browserless" || prefer === "auto") {
    if (browserlessConfigured()) return openBrowserlessSession();
  }
  if (prefer === "browserbase" || prefer === "auto") {
    if (browserbaseConfigured()) return openBrowserbaseSession();
  }
  if (prefer === "browserless" && browserbaseConfigured()) {
    return openBrowserbaseSession();
  }
  if (prefer === "browserbase" && browserlessConfigured()) {
    return openBrowserlessSession();
  }
  return null;
}

/**
 * Open a browser for scanning / lessons.
 * Local Chromium is preferred on developer machines, but if the binary is
 * missing we fall back to Browserless / Browserbase when configured.
 */
export async function openLiveBrowser(): Promise<LiveBrowserHandle> {
  const pref = preferredBrowserProvider();

  if (pref === "local") {
    try {
      return await openLocalBrowserSession();
    } catch (localError) {
      const cloud = await openCloudBrowser("auto");
      if (cloud) return cloud;
      throw localError;
    }
  }

  if (pref === "browserless") {
    const cloud = await openCloudBrowser("browserless");
    if (cloud) return cloud;
  }
  if (pref === "browserbase") {
    const cloud = await openCloudBrowser("browserbase");
    if (cloud) return cloud;
  }

  // Last resort: try local even when preference was cloud (e.g. key missing).
  if (localPlaywrightAllowed()) {
    try {
      return await openLocalBrowserSession();
    } catch {
      /* fall through */
    }
  }

  throw new Error(
    isServerlessHost()
      ? "Add BROWSERLESS_API_KEY (or BROWSERBASE_API_KEY) in Vercel env. Local Chromium cannot run on Vercel."
      : "Local Chromium failed to start and no cloud browser key is loaded. Run `npx playwright install chromium`, or set BROWSERBASE_API_KEY / BROWSERLESS_API_KEY and restart the dev server.",
  );
}
