import type { Page } from "playwright-core";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ChallengeSeverity = "minor" | "major";

export type BrowserChallenge = {
  reason: string;
  /**
   * minor — cookie / soft interstitial; agent may dismiss or soft-continue.
   * major — interactive CAPTCHA / Google bot walls; needs Take control.
   */
  severity: ChallengeSeverity;
};

const MAJOR_URL_HINTS =
  /\/sorry\/|ipv4\.google|ipv6\.google|recaptcha|hcaptcha|cf-browser-verification|cdn-cgi\/challenge|challenges\.cloudflare|consent\.google/i;

const MINOR_URL_HINTS =
  /cookie|consent|privacy|gdpr|cmp\.|onetrust|cookielaw|trustarc|quantcast|didomi/i;

const MAJOR_TITLE_HINTS =
  /unusual traffic|not a robot|verify you are human|attention required|captcha|are you a robot|sign in to confirm|enable javascript and cookies|access denied/i;

const MINOR_TITLE_HINTS =
  /just a moment|security check|before you continue|privacy|cookie|consent|we value your privacy|manage cookies/i;

/**
 * Heuristic challenge detection for CAPTCHA / Google sign-in walls.
 * These are core Take-control drills — pause the agent for the human.
 */
export async function detectBrowserChallenge(
  page: Page,
): Promise<BrowserChallenge | null> {
  let url = "";
  let title = "";
  try {
    url = page.url();
    title = await page.title().catch(() => "");
  } catch {
    return null;
  }

  // Core product test: Google OAuth / “browser not secure”.
  if (isGoogleAuthUrl(url)) {
    return {
      severity: "major",
      reason:
        "Google sign-in (“browser may not be secure”). Take control, finish sign-in if you can, then Resume.",
    };
  }

  const isYouTubeHost = /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(
    url,
  );

  if (MAJOR_URL_HINTS.test(url)) {
    return {
      severity: "major",
      reason: "This page is asking for a human check (URL).",
    };
  }
  if (MINOR_URL_HINTS.test(url)) {
    return {
      severity: "minor",
      reason: "This page has a cookie / consent check — we’ll try to continue.",
    };
  }
  if (MAJOR_TITLE_HINTS.test(title) && !isYouTubeHost) {
    return {
      severity: "major",
      reason: `Browser check: “${title.slice(0, 80)}”`,
    };
  }
  if (MINOR_TITLE_HINTS.test(title) && !isYouTubeHost) {
    return {
      severity: "minor",
      reason: `Soft check: “${title.slice(0, 80)}” — trying to continue.`,
    };
  }

  try {
    const kind = await page.evaluate((youtube) => {
      const text = `${document.title}\n${document.body?.innerText?.slice(0, 5_000) ?? ""}`;
      const lower = text.toLowerCase();

      if (
        /this browser or app may not be secure|couldn.?t sign you in/i.test(
          lower,
        )
      ) {
        return "google_secure";
      }
      if (
        /sign in to confirm you.?re not a bot|sign in to confirm that you/i.test(
          lower,
        )
      ) {
        return "youtube_bot";
      }

      const captchaWidget = Boolean(
        document.querySelector(
          "iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='turnstile'], .g-recaptcha, .h-captcha, #challenge-form, #cf-challenge-running",
        ),
      );

      // Cookie / consent banners — minor, agent can click Accept.
      const consentText =
        /accept all cookies|accept cookies|agree and continue|i agree|got it|allow all|consent to cookies|we use cookies|manage cookie preferences|reject non-essential/i.test(
          lower,
        );
      const consentWidget = Boolean(
        document.querySelector(
          [
            "#onetrust-accept-btn-handler",
            "#onetrust-banner-sdk",
            ".cc-accept",
            ".cc-allow",
            "[data-testid='cookie-policy-dialog']",
            "[aria-label*='cookie' i]",
            "[id*='cookie' i] button",
            "[class*='cookie' i] button",
            "[class*='consent' i] button",
          ].join(","),
        ),
      );

      if (youtube) {
        if (captchaWidget) return "captcha";
        if (/sign in to confirm/i.test(lower)) return "youtube_bot";
        return null;
      }

      if (captchaWidget) return "captcha";

      const hardPatterns = [
        "i'm not a robot",
        "i am not a robot",
        "verify you are human",
        "unusual traffic from your computer",
        "checking your browser before accessing",
        "please complete the security check",
        "confirm you are a human",
        "press and hold",
      ];
      if (hardPatterns.some((p) => lower.includes(p))) {
        // Cloudflare "checking your browser" / "just a moment" often auto-clears.
        if (
          /checking your browser before accessing|just a moment|please wait/i.test(
            lower,
          ) &&
          !captchaWidget
        ) {
          return "soft_wait";
        }
        return "captcha";
      }

      if (consentText || consentWidget) return "consent";
      return null;
    }, isYouTubeHost);

    if (kind === "google_secure") {
      return {
        severity: "major",
        reason:
          "Google blocked this browser (“may not be secure”). Take control and try sign-in, then Resume.",
      };
    }
    if (kind === "youtube_bot") {
      return {
        severity: "major",
        reason:
          "YouTube wants you to sign in to confirm you’re not a bot. Take control, finish it, then Resume.",
      };
    }
    if (kind === "captcha") {
      return {
        severity: "major",
        reason:
          "This page needs you to confirm you’re human. Take control, finish the check, then Resume.",
      };
    }
    if (kind === "soft_wait") {
      return {
        severity: "minor",
        reason:
          "Brief security wait on this page — continuing if content appears.",
      };
    }
    if (kind === "consent") {
      return {
        severity: "minor",
        reason: "Cookie / consent banner — dismissing so we can use this source.",
      };
    }
  } catch {
    /* navigation mid-evaluate */
  }

  return null;
}

/**
 * Click common Accept / Agree / Continue controls on minor walls.
 * Returns true if something was clicked.
 */
export async function tryDismissMinorChallenge(page: Page): Promise<boolean> {
  const selectors = [
    "#onetrust-accept-btn-handler",
    "#accept-cookie-notification",
    "button#accept-cookies",
    "button[aria-label='Accept all']",
    "button[aria-label='Accept All']",
    "button[aria-label*='Accept cookies' i]",
    "button[aria-label*='Agree' i]",
    "[data-testid='accept-cookies']",
    ".cc-accept",
    ".cc-allow",
    ".fc-cta-consent",
    "#L2AGLb", // Google consent
    "form[action*='consent'] button",
  ];

  for (const selector of selectors) {
    try {
      const loc = page.locator(selector).first();
      if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
        await loc.click({ timeout: 2_000 });
        await delay(600);
        return true;
      }
    } catch {
      /* try next */
    }
  }

  // Text-button fallback for common consent copy.
  try {
    const clicked = await page.evaluate(() => {
      const labels =
        /^(accept all|accept all cookies|accept cookies|agree|i agree|agree and continue|got it|allow all|allow cookies|ok|continue|yes,? i agree)$/i;
      const buttons = Array.from(
        document.querySelectorAll("button, [role='button'], input[type='submit'], a"),
      );
      for (const el of buttons) {
        const text = (el.textContent || (el as HTMLInputElement).value || "")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length < 2 || text.length > 48) continue;
        if (!labels.test(text)) continue;
        (el as HTMLElement).click();
        return true;
      }
      return false;
    });
    if (clicked) {
      await delay(700);
      return true;
    }
  } catch {
    /* ignore */
  }

  // Soft Cloudflare wait — give it a moment to clear without interaction.
  await delay(2_200);
  return false;
}

/** Google OAuth / account chooser URLs. */
export function isGoogleAuthUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "accounts.google.com" ||
      host === "account.google.com" ||
      (host.endsWith(".google.com") &&
        /\/signin|\/ServiceLogin|\/oauth|\/AccountChooser/i.test(url))
    );
  } catch {
    return /accounts\.google\.com|ServiceLogin|\/signin\/oauth/i.test(url);
  }
}

/** Pure helpers for smokes — no Playwright. */
export function challengeFromUrlOrTitle(
  url: string,
  title: string,
): BrowserChallenge | null {
  if (isGoogleAuthUrl(url)) {
    return {
      severity: "major",
      reason:
        "Google sign-in (“browser may not be secure”). Take control, finish sign-in if you can, then Resume.",
    };
  }
  if (MAJOR_URL_HINTS.test(url)) {
    return {
      severity: "major",
      reason: "This page is asking for a human check (URL).",
    };
  }
  if (MINOR_URL_HINTS.test(url)) {
    return {
      severity: "minor",
      reason: "This page has a cookie / consent check — we’ll try to continue.",
    };
  }
  if (MAJOR_TITLE_HINTS.test(title)) {
    return {
      severity: "major",
      reason: `Browser check: “${title.slice(0, 80)}”`,
    };
  }
  if (MINOR_TITLE_HINTS.test(title)) {
    return {
      severity: "minor",
      reason: `Soft check: “${title.slice(0, 80)}” — trying to continue.`,
    };
  }
  return null;
}
