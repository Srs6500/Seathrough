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

export async function openLiveBrowser(): Promise<LiveBrowserHandle> {
  const pref = preferredBrowserProvider();
  if (pref === "local") return openLocalBrowserSession();
  if (pref === "browserless") return openBrowserlessSession();
  if (pref === "browserbase") return openBrowserbaseSession();
  throw new Error(
    isServerlessHost()
      ? "Add BROWSERLESS_API_KEY (or BROWSERBASE_API_KEY) in Vercel env. Local Chromium cannot run on Vercel."
      : "Local Chromium failed to resolve. On Railway, rebuild so the Dockerfile installs Chromium. Locally run: npx playwright install chromium.",
  );
}
