import { chromium, type Browser } from "playwright-core";
import type { LiveBrowserHandle } from "@/lib/browser-experience/driver";
import { localPlaywrightAllowed } from "@/lib/browser-experience/host";

let sharedBrowserPromise: Promise<Browser> | null = null;
let sharedBrowserHeaded: boolean | null = null;

/**
 * Headed Chromium (separate OS window). Default OFF — Take control uses
 * in-app click/type relay on the screenshot so users stay inside SeeThrough.
 * Set BROWSER_LOCAL_HEADED=1 if you want a desktop window too.
 */
function localHeaded(): boolean {
  const raw = (process.env.BROWSER_LOCAL_HEADED || "0").toLowerCase().trim();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

async function launchChromium(): Promise<Browser> {
  if (!localPlaywrightAllowed()) {
    throw new Error(
      "Local Chromium is not available on this host. Set BROWSERLESS_API_KEY or BROWSERBASE_API_KEY for cloud browser sessions.",
    );
  }
  const headed = localHeaded();
  const args = [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--window-size=1280,800",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-blink-features=AutomationControlled",
  ];
  // Prefer Playwright's bundled Chromium. Do not fall back to system Chrome —
  // that path fails on CI/Vercel (/opt/google/chrome) and confuses the error.
  return chromium.launch({
    headless: !headed,
    args,
    ...(headed ? { channel: undefined } : {}),
  });
}

async function getSharedBrowser(): Promise<Browser> {
  const headed = localHeaded();
  if (sharedBrowserPromise && sharedBrowserHeaded !== headed) {
    // Headed/headless flip requires a fresh browser process.
    const prev = await sharedBrowserPromise.catch(() => null);
    await prev?.close().catch(() => undefined);
    sharedBrowserPromise = null;
  }
  if (!sharedBrowserPromise) {
    sharedBrowserHeaded = headed;
    sharedBrowserPromise = launchChromium().catch((error) => {
      sharedBrowserPromise = null;
      sharedBrowserHeaded = null;
      const message =
        error instanceof Error ? error.message : "Chromium launch failed";
      throw new Error(
        `Local browser failed to start. Install Chromium with \`npx playwright install chromium\`, or set BROWSERLESS_API_KEY / BROWSERBASE_API_KEY. (${message})`,
      );
    });
  }
  return sharedBrowserPromise;
}

export async function openLocalBrowserSession(): Promise<LiveBrowserHandle> {
  const browser = await getSharedBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  // Bring the headed window forward so Take-control drills are obvious.
  if (localHeaded()) {
    await page.bringToFront().catch(() => undefined);
  }
  return {
    provider: "local",
    liveViewUrl: null,
    browser,
    page,
  };
}

export async function localBrowserAvailable(): Promise<boolean> {
  try {
    await getSharedBrowser();
    return true;
  } catch {
    return false;
  }
}

export function isLocalHeaded(): boolean {
  return localHeaded();
}
