import type { Page } from "playwright-core";
import { closeBrowserbaseRemote } from "@/lib/browser-experience/browserbase";
import { openLiveBrowser } from "@/lib/browser-experience/openBrowser";
import { FRONTEND_HEALTH_CATEGORIES } from "@/lib/frontend-health/categories";
import { loadBrokenDemoHtml } from "@/lib/frontend-health/fixtureHtml";
import { runAxeOnPage } from "@/lib/frontend-health/runAxe";
import type {
  ElementRect,
  FrontendCheckSummary,
  FrontendFinding,
  FrontendScanResult,
} from "@/lib/frontend-health/types";

function categoryLabel(id: (typeof FRONTEND_HEALTH_CATEGORIES)[number]["id"]): string {
  return (
    FRONTEND_HEALTH_CATEGORIES.find((c) => c.id === id)?.label || id
  );
}

type ScanOptions = {
  /** Live URL to open (e.g. http://localhost:3000/frontend-health-demo). */
  targetUrl?: string;
  /** When true (default if no URL), load the bundled broken HTML fixture. */
  useFixture?: boolean;
};

type AnnotatedEl = {
  selector: string;
  tag: string;
  text: string;
  component?: string;
  sourceFile?: string;
  sourceLine?: number;
  rect: ElementRect;
};

type ScanCtx = {
  page: Page;
  useFixture: boolean;
  targetUrl: string;
  findings: FrontendFinding[];
  checks: FrontendCheckSummary[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; status: number }>;
  nextId: (prefix: string) => string;
};

function parseSource(raw?: string | null): {
  sourceFile?: string;
  sourceLine?: number;
} {
  if (!raw) return {};
  const match = raw.match(/^(.+):(\d+)$/);
  if (!match) return { sourceFile: raw };
  return { sourceFile: match[1], sourceLine: Number(match[2]) };
}

/** Document-space rects (for full-page screenshot overlays). */
async function collectAnnotated(page: Page): Promise<AnnotatedEl[]> {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a[href], input, img, form, [data-st-source], #mobile-menu",
      ),
    );
    const sx = window.scrollX;
    const sy = window.scrollY;
    return nodes.map((el, index) => {
      const rect = el.getBoundingClientRect();
      const source = el.getAttribute("data-st-source");
      let sourceFile: string | undefined;
      let sourceLine: number | undefined;
      if (source) {
        const m = source.match(/^(.+):(\d+)$/);
        if (m) {
          sourceFile = m[1]!;
          sourceLine = Number(m[2]);
        } else sourceFile = source;
      }
      const id = el.id ? `#${el.id}` : null;
      const selector =
        id ||
        (el.getAttribute("data-st-source")
          ? `[data-st-source="${el.getAttribute("data-st-source")}"]`
          : `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`);
      return {
        selector,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute("alt") || el.id || el.tagName)
          .trim()
          .slice(0, 80),
        component: el.getAttribute("data-st-component") || undefined,
        sourceFile,
        sourceLine,
        rect: {
          x: rect.x + sx,
          y: rect.y + sy,
          width: rect.width,
          height: rect.height,
        },
      };
    });
  });
}

/** Scroll the document so lazy sections mount before checks / screenshot. */
async function revealFullPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const height = () =>
      Math.max(
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
      );
    let y = 0;
    const step = Math.max(400, Math.floor(window.innerHeight * 0.85));
    let guard = 0;
    while (y < height() && guard < 40) {
      window.scrollTo(0, y);
      await delay(120);
      y += step;
      guard += 1;
    }
    window.scrollTo(0, height());
    await delay(150);
    window.scrollTo(0, 0);
    await delay(100);
  });
}

async function documentSize(
  page: Page,
): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({
    width: Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
      1280,
    ),
    height: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
      800,
    ),
  }));
}

/** Extra routes beyond the entry URL (same-origin nav / in-page links). */
async function discoverExtraRoutes(
  page: Page,
  entryUrl: string,
  limit = 5,
): Promise<string[]> {
  const origin = new URL(entryUrl).origin;
  const entryPath = new URL(entryUrl).pathname.replace(/\/$/, "") || "/";
  const hrefs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((a) => a.href)
      .filter(Boolean);
  });
  const out: string[] = [];
  const seen = new Set<string>([entryPath]);
  for (const href of hrefs) {
    try {
      const u = new URL(href);
      if (u.origin !== origin) continue;
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const path = u.pathname.replace(/\/$/, "") || "/";
      if (seen.has(path)) continue;
      // Skip auth / logout / assets
      if (
        /\/(api|auth|login|logout|signin|sign-out|_next|static)\b/i.test(path)
      ) {
        continue;
      }
      seen.add(path);
      out.push(`${origin}${u.pathname}${u.search}`);
      if (out.length >= limit) break;
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Lighter pass on secondary routes — runtime + axe + scroll. */
async function scanSecondaryPage(
  ctx: ScanCtx,
  url: string,
): Promise<void> {
  const { page, findings, pageErrors, nextId } = ctx;
  const beforeErrors = pageErrors.length;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch {
    findings.push({
      id: nextId("nav"),
      issue_type: "broken_navigation",
      severity: "error",
      title: "Route failed to load",
      summary: `Could not open ${url}`,
      page: (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })(),
      evidence: { request_url: url, notes: "goto timed out or failed." },
      suggested_fix: "Ensure the route exists and responds within a few seconds.",
      verification: "confirmed",
    });
    return;
  }
  await page.waitForTimeout(200);
  await revealFullPage(page);
  const pagePath = pathnameOf(page, false);
  const newErrors = [
    ...new Set(pageErrors.slice(beforeErrors).map((e) => e.trim()).filter(Boolean)),
  ];
  for (const err of newErrors.slice(0, 2)) {
    findings.push({
      id: nextId("runtime"),
      issue_type: "runtime_error",
      severity: "error",
      title: "JavaScript error on page",
      summary: err.slice(0, 120),
      page: pagePath,
      evidence: { error: err, notes: `Observed on ${url}` },
      suggested_fix:
        "Open this route in the browser console and fix the throwing code path.",
      verification: "confirmed",
    });
  }
  try {
    const axe = await runAxeOnPage(page);
    for (const v of axe.violations.slice(0, 3)) {
      const node = v.nodes[0];
      const target = node?.target?.[0];
      const selector =
        typeof target === "string"
          ? target
          : Array.isArray(target)
            ? String(target[0])
            : undefined;
      findings.push({
        id: nextId("a11y"),
        issue_type: "accessibility",
        severity:
          v.impact === "critical" || v.impact === "serious" ? "error" : "warning",
        title: v.id.replace(/-/g, " "),
        summary: v.help,
        page: pagePath,
        selector,
        element: selector,
        evidence: {
          notes: `${pagePath}: ${(node?.failureSummary || v.description).slice(0, 200)}`,
        },
        suggested_fix: v.helpUrl
          ? `See ${v.helpUrl}`
          : "Fix the accessibility rule reported by axe-core.",
        verification: "confirmed",
      });
    }
  } catch {
    /* axe optional on secondary pages */
  }
}

function pathnameOf(page: Page, useFixture: boolean): string {
  if (useFixture) return "/";
  try {
    return new URL(page.url()).pathname || "/";
  } catch {
    return "/";
  }
}

/** Demo fixture — targeted selectors that prove the product end-to-end. */
async function runFixtureChecks(ctx: ScanCtx): Promise<void> {
  const { page, findings, checks, pageErrors, nextId } = ctx;
  const pagePath = "/";

  // 1) runtime crash on #submit-btn
  const beforeErrors = pageErrors.length;
  const submit = page.locator("#submit-btn");
  if ((await submit.count()) > 0) {
    try {
      await submit.click({ timeout: 3000 });
      await page.waitForTimeout(300);
    } catch {
      /* still inspect errors */
    }
    const newErrors = pageErrors.slice(beforeErrors);
    if (newErrors.length) {
      const meta = parseSource(await submit.getAttribute("data-st-source"));
      const component =
        (await submit.getAttribute("data-st-component")) || undefined;
      const box = await submit.boundingBox();
      findings.push({
        id: nextId("runtime"),
        issue_type: "runtime_error",
        severity: "error",
        title: "Submit button",
        summary: "Click causes an unhandled exception",
        page: pagePath,
        component,
        element: "button#submit-btn",
        selector: "#submit-btn",
        source_file: meta.sourceFile,
        source_line: meta.sourceLine,
        rect: box
          ? { x: box.x, y: box.y, width: box.width, height: box.height }
          : undefined,
        evidence: {
          action: "click",
          error: newErrors[0],
          request_status: null,
        },
        suggested_fix:
          "Inspect the submit handler and guard undefined values before invoking the API.",
        verification: "confirmed",
      });
      checks.push({
        id: "buttons_interactions",
        label: categoryLabel("buttons_interactions"),
        status: "failed",
      });
      checks.push({
        id: "runtime_errors",
        label: categoryLabel("runtime_errors"),
        status: "failed",
      });
    } else {
      checks.push({
        id: "buttons_interactions",
        label: categoryLabel("buttons_interactions"),
        status: "passed",
      });
      checks.push({
        id: "runtime_errors",
        label: categoryLabel("runtime_errors"),
        status: "passed",
      });
    }
  } else {
    checks.push({
      id: "buttons_interactions",
      label: categoryLabel("buttons_interactions"),
      status: "skipped",
    });
    checks.push({
      id: "runtime_errors",
      label: categoryLabel("runtime_errors"),
      status: "skipped",
    });
  }

  await page.setContent(loadBrokenDemoHtml(), {
    waitUntil: "domcontentloaded",
  });

  // 2) broken nav
  const brokenLink = page.locator("#broken-nav");
  if ((await brokenLink.count()) > 0) {
    const href = (await brokenLink.getAttribute("href")) || "";
    const meta = parseSource(await brokenLink.getAttribute("data-st-source"));
    const component =
      (await brokenLink.getAttribute("data-st-component")) || undefined;
    const box = await brokenLink.boundingBox();
    const isBroken = href.includes("does-not-exist") || href.includes("404");
    if (isBroken) {
      findings.push({
        id: nextId("nav"),
        issue_type: "broken_navigation",
        severity: "error",
        title: "Contact link",
        summary: "Link leads to a 404 page",
        page: pagePath,
        component,
        element: "a#broken-nav",
        selector: "#broken-nav",
        source_file: meta.sourceFile,
        source_line: meta.sourceLine,
        rect: box
          ? { x: box.x, y: box.y, width: box.width, height: box.height }
          : undefined,
        evidence: {
          action: "click",
          request_status: null,
          request_url: href,
          notes: `Link target "${href}" is not a valid route in the demo app.`,
        },
        suggested_fix: "Point the link at a real route, or add the missing page.",
        verification: "confirmed",
      });
      checks.push({
        id: "navigation",
        label: categoryLabel("navigation"),
        status: "failed",
      });
    } else {
      checks.push({
        id: "navigation",
        label: categoryLabel("navigation"),
        status: "passed",
      });
    }
  } else {
    checks.push({
      id: "navigation",
      label: categoryLabel("navigation"),
      status: "skipped",
    });
  }

  // 3) form validation
  const email = page.locator("#email");
  if ((await email.count()) > 0) {
    await email.fill("not-an-email");
    const value = await email.inputValue();
    const type = await email.getAttribute("type");
    await email.blur();
    await page.waitForTimeout(100);
    const statusText = (
      await page.locator("#status").innerText().catch(() => "")
    ).toLowerCase();
    const acceptsInvalid =
      type !== "email" &&
      value === "not-an-email" &&
      !statusText.includes("invalid") &&
      !statusText.includes("valid");
    if (acceptsInvalid) {
      const form = page.locator("#contact-form");
      const meta = parseSource(await form.getAttribute("data-st-source"));
      const component =
        (await form.getAttribute("data-st-component")) || undefined;
      const box = await email.boundingBox();
      findings.push({
        id: nextId("form"),
        issue_type: "form_validation",
        severity: "warning",
        title: "Email field",
        summary: "Invalid email is accepted without validation feedback",
        page: pagePath,
        component,
        element: "input#email",
        selector: "#email",
        source_file: meta.sourceFile,
        source_line: meta.sourceLine,
        rect: box
          ? { x: box.x, y: box.y, width: box.width, height: box.height }
          : undefined,
        evidence: {
          action: "fill",
          notes: `Entered "${value}" into input type="${type ?? "text"}" with no validation message.`,
        },
        suggested_fix:
          'Use input type="email" (or a schema validator) and show an error when the value is invalid.',
        verification: "confirmed",
      });
      checks.push({
        id: "forms",
        label: categoryLabel("forms"),
        status: "failed",
      });
    } else {
      checks.push({
        id: "forms",
        label: categoryLabel("forms"),
        status: "passed",
      });
    }
  } else {
    checks.push({
      id: "forms",
      label: categoryLabel("forms"),
      status: "skipped",
    });
  }

  // 4) accessibility — axe-core + hero alt fallback
  let a11yFailed = false;
  try {
    const axe = await runAxeOnPage(page);
    for (const v of axe.violations.slice(0, 6)) {
      a11yFailed = true;
      const node = v.nodes[0];
      const target = node?.target?.[0];
      const selector =
        typeof target === "string" ? target : Array.isArray(target) ? String(target[0]) : undefined;
      findings.push({
        id: nextId("a11y"),
        issue_type: "accessibility",
        severity: v.impact === "critical" || v.impact === "serious" ? "error" : "warning",
        title: v.id,
        summary: v.help,
        page: pagePath,
        selector,
        element: selector,
        evidence: {
          notes: (node?.failureSummary || v.description).slice(0, 240),
        },
        suggested_fix: v.helpUrl || "Fix the accessibility rule reported by axe-core.",
        verification: "confirmed",
      });
    }
  } catch {
    /* axe optional on fixture — fall through to hero check */
  }

  const hero = page.locator("#hero-image");
  if ((await hero.count()) > 0) {
    const alt = await hero.getAttribute("alt");
    if (!alt || !alt.trim()) {
      a11yFailed = true;
      const meta = parseSource(await hero.getAttribute("data-st-source"));
      const component =
        (await hero.getAttribute("data-st-component")) || undefined;
      const box = await hero.boundingBox();
      findings.push({
        id: nextId("a11y"),
        issue_type: "accessibility",
        severity: "warning",
        title: "Hero image",
        summary: "Image is missing descriptive alternative text",
        page: pagePath,
        component,
        element: "img#hero-image",
        selector: "#hero-image",
        source_file: meta.sourceFile,
        source_line: meta.sourceLine,
        rect: box
          ? { x: box.x, y: box.y, width: box.width, height: box.height }
          : undefined,
        evidence: { notes: "img has empty or missing alt attribute." },
        suggested_fix:
          'Add a meaningful alt attribute, or alt="" if the image is decorative.',
        verification: "confirmed",
      });
    }
  }
  checks.push({
    id: "accessibility",
    label: categoryLabel("accessibility"),
    status: a11yFailed ? "failed" : "passed",
  });

  // 5) mobile menu overflow
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => {
    const menu = document.getElementById("mobile-menu");
    if (!menu) return null;
    const rect = menu.getBoundingClientRect();
    const clipped = rect.right > window.innerWidth + 1;
    return {
      clipped,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      source: menu.getAttribute("data-st-source"),
      component: menu.getAttribute("data-st-component"),
    };
  });

  if (overflow?.clipped) {
    const meta = parseSource(overflow.source);
    findings.push({
      id: nextId("layout"),
      issue_type: "layout_overflow",
      severity: "warning",
      title: "Mobile menu",
      summary: "Menu is clipped at a narrow viewport",
      page: pagePath,
      component: overflow.component || undefined,
      element: "#mobile-menu",
      selector: "#mobile-menu",
      source_file: meta.sourceFile,
      source_line: meta.sourceLine,
      rect: overflow.rect,
      evidence: {
        action: "viewport:375",
        notes: `Element extends to x=${Math.round(overflow.rect.x + overflow.rect.width)} beyond viewport width 375.`,
      },
      suggested_fix:
        "Use a wrapping flex layout, horizontal scroll with overflow-x auto, or a hamburger menu under ~640px.",
      verification: "confirmed",
    });
    checks.push({
      id: "responsive_layouts",
      label: categoryLabel("responsive_layouts"),
      status: "failed",
    });
  } else {
    checks.push({
      id: "responsive_layouts",
      label: categoryLabel("responsive_layouts"),
      status: overflow ? "passed" : "skipped",
    });
  }

  sortChecksByCategory(checks);
}

/**
 * Live URL — all six product categories.
 * 1 Buttons · 2 Forms · 3 Navigation · 4 Runtime · 5 Responsive · 6 Accessibility (axe-core)
 */
async function runLiveChecks(ctx: ScanCtx): Promise<void> {
  const { page, findings, checks, pageErrors, failedRequests, nextId, targetUrl } =
    ctx;
  const pagePath = pathnameOf(page, false);
  const startUrl = page.url();

  // Ensure below-the-fold content is mounted before interacting
  await revealFullPage(page);

  // --- 4) Runtime errors (load) + failed requests as supporting evidence ---
  const uniqueErrors = [
    ...new Set(pageErrors.map((e) => e.trim()).filter(Boolean)),
  ];
  let runtimeFailed = uniqueErrors.length > 0;
  for (const err of uniqueErrors.slice(0, 3)) {
    findings.push({
      id: nextId("runtime"),
      issue_type: "runtime_error",
      severity: "error",
      title: "JavaScript error on load",
      summary: err.slice(0, 120),
      page: pagePath,
      evidence: {
        error: err,
        notes: "Observed via pageerror / console error.",
      },
      suggested_fix:
        "Open the browser console on this URL, reproduce the error, and fix the throwing code path.",
      verification: "confirmed",
    });
  }

  const noisy =
    /(favicon|analytics|gtag|google-analytics|hotjar|segment|sentry\.io\/api|chrome-extension)/i;
  const uniqueFails = failedRequests
    .filter((r) => r.status >= 400 && !noisy.test(r.url))
    .filter((r, i, arr) => arr.findIndex((x) => x.url === r.url && x.status === r.status) === i)
    .slice(0, 4);
  for (const r of uniqueFails) {
    runtimeFailed = true;
    let hostPath = r.url;
    try {
      const u = new URL(r.url);
      hostPath = `${u.pathname}${u.search}`.slice(0, 80);
    } catch {
      /* keep */
    }
    findings.push({
      id: nextId("req"),
      issue_type: "failed_request",
      severity: r.status >= 500 ? "error" : "warning",
      title: `HTTP ${r.status} request`,
      summary: `Request failed: ${hostPath}`,
      page: pagePath,
      evidence: { request_status: r.status, request_url: r.url },
      suggested_fix:
        "Confirm the endpoint exists and returns a success status for this page.",
      verification: "confirmed",
    });
  }

  // --- 1) Buttons and interactions — click sample controls, watch for crashes ---
  const buttons = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, [role="button"], input[type="submit"], input[type="button"]',
      ),
    );
    return nodes
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.visibility === "hidden" || style.display === "none") return false;
        if (rect.width < 8 || rect.height < 8) return false;
        if ((el as HTMLButtonElement).disabled) return false;
        return true;
      })
      .slice(0, 4)
      .map((el, index) => {
        const text = (el.innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "Button")
          .trim()
          .slice(0, 60);
        return {
          selector: el.id
            ? `#${el.id}`
            : `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
          text,
        };
      });
  });

  let buttonIssues = 0;
  for (const btn of buttons) {
    const before = pageErrors.length;
    const loc = page.locator(btn.selector).first();
    if ((await loc.count()) === 0) continue;
    try {
      await loc.click({ timeout: 2500, noWaitAfter: true });
      await page.waitForTimeout(350);
    } catch {
      /* click may navigate or detach */
    }
    const newErrors = pageErrors.slice(before).filter(Boolean);
    if (newErrors.length) {
      buttonIssues += 1;
      runtimeFailed = true;
      const box = await loc.boundingBox().catch(() => null);
      findings.push({
        id: nextId("btn"),
        issue_type: "runtime_error",
        severity: "error",
        title: btn.text || "Button",
        summary: "Click causes an unhandled exception",
        page: pagePath,
        element: btn.selector,
        selector: btn.selector,
        rect: box
          ? { x: box.x, y: box.y, width: box.width, height: box.height }
          : undefined,
        evidence: {
          action: "click",
          error: newErrors[0],
        },
        suggested_fix:
          "Inspect the click handler and guard undefined values before invoking side effects.",
        verification: "confirmed",
      });
    }
    // Return to start page if navigation happened
    if (page.url() !== startUrl) {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      }).catch(() => undefined);
      await page.waitForTimeout(100);
    }
  }
  checks.push({
    id: "buttons_interactions",
    label: categoryLabel("buttons_interactions"),
    status: buttons.length === 0 ? "skipped" : buttonIssues ? "failed" : "passed",
  });
  checks.push({
    id: "runtime_errors",
    label: categoryLabel("runtime_errors"),
    status: runtimeFailed ? "failed" : "passed",
  });

  // --- 2) Forms — email type + empty required submit ---
  const formTargets = await page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select",
      ),
    );
    const emailish = inputs
      .filter((el) => {
        const hint =
          `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("autocomplete") || ""}`.toLowerCase();
        return hint.includes("email") || el.type === "email";
      })
      .slice(0, 3)
      .map((el) => ({
        kind: "email" as const,
        type: el.type || "text",
        required: el.required,
        selector: el.id
          ? `#${el.id}`
          : el.name
            ? `input[name="${el.name}"]`
            : "input",
        label: el.placeholder || el.name || el.id || "email field",
      }));

    const forms = Array.from(document.querySelectorAll("form")).slice(0, 2);
    const requiredForms: Array<{
      formSelector: string;
      submitSelector: string | null;
      requiredCount: number;
    }> = [];
    forms.forEach((form, fi) => {
      const required = Array.from(
        form.querySelectorAll<HTMLInputElement>(
          "input[required], textarea[required], select[required]",
        ),
      );
      if (!required.length) return;
      const submit =
        form.querySelector<HTMLElement>(
          'button[type="submit"], input[type="submit"]',
        ) || form.querySelector<HTMLElement>("button:not([type])");
      requiredForms.push({
        formSelector: form.id ? `#${form.id}` : `form:nth-of-type(${fi + 1})`,
        submitSelector: submit
          ? submit.id
            ? `#${submit.id}`
            : 'button[type="submit"], input[type="submit"], button:not([type])'
          : null,
        requiredCount: required.length,
      });
    });

    return { emailish, requiredForms };
  });

  let formIssues = 0;
  for (const field of formTargets.emailish) {
    if (field.type === "email") continue;
    const loc = page.locator(field.selector).first();
    if ((await loc.count()) === 0) continue;
    await loc.fill("not-an-email").catch(() => undefined);
    await loc.blur().catch(() => undefined);
    await page.waitForTimeout(80);
    const box = await loc.boundingBox().catch(() => null);
    formIssues += 1;
    findings.push({
      id: nextId("form"),
      issue_type: "form_validation",
      severity: "warning",
      title: field.label,
      summary: "Invalid email is accepted without native email validation",
      page: pagePath,
      element: field.selector,
      selector: field.selector,
      rect: box
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : undefined,
      evidence: {
        action: "fill",
        notes: `Input type="${field.type}" accepted "not-an-email".`,
      },
      suggested_fix:
        'Use input type="email" (or a schema validator) and show an error when the value is invalid.',
      verification: "suspected",
    });
  }

  for (const form of formTargets.requiredForms) {
    if (!form.submitSelector) continue;
    // Clear required fields then try submit — expect validation to block
    await page.evaluate((sel) => {
      const formEl = document.querySelector(sel);
      if (!formEl) return;
      for (const el of Array.from(
        formEl.querySelectorAll<HTMLInputElement>("input[required], textarea[required]"),
      )) {
        if (el.type === "checkbox" || el.type === "radio") {
          el.checked = false;
        } else {
          el.value = "";
        }
      }
    }, form.formSelector);
    const valid = await page.evaluate((sel) => {
      const formEl = document.querySelector(sel) as HTMLFormElement | null;
      return formEl ? formEl.checkValidity() : true;
    }, form.formSelector);
    if (valid) {
      formIssues += 1;
      findings.push({
        id: nextId("form"),
        issue_type: "form_validation",
        severity: "warning",
        title: "Required fields",
        summary: "Form reports valid while required fields are empty",
        page: pagePath,
        element: form.formSelector,
        selector: form.formSelector,
        evidence: {
          action: "checkValidity",
          notes: `${form.requiredCount} required control(s) were cleared; checkValidity() still returned true.`,
        },
        suggested_fix:
          "Mark required inputs with the required attribute (or validate on submit and block empty values).",
        verification: "suspected",
      });
    }
  }

  checks.push({
    id: "forms",
    label: categoryLabel("forms"),
    status:
      formTargets.emailish.length + formTargets.requiredForms.length === 0
        ? "skipped"
        : formIssues
          ? "failed"
          : "passed",
  });

  // --- 3) Navigation — sample same-origin links ---
  const linkHrefs = await page.evaluate(() => {
    const origin = location.origin;
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a[href]"),
    );
    const out: Array<{ href: string; text: string; selector: string }> = [];
    const seen = new Set<string>();
    for (const a of anchors) {
      const raw = a.getAttribute("href") || "";
      if (
        !raw ||
        raw.startsWith("#") ||
        raw.startsWith("mailto:") ||
        raw.startsWith("tel:")
      ) {
        continue;
      }
      let abs: URL;
      try {
        abs = new URL(raw, location.href);
      } catch {
        continue;
      }
      if (abs.origin !== origin) continue;
      if (seen.has(abs.pathname)) continue;
      seen.add(abs.pathname);
      out.push({
        href: abs.toString(),
        text: (a.innerText || a.getAttribute("aria-label") || raw)
          .trim()
          .slice(0, 60),
        selector: a.id ? `#${a.id}` : `a[href="${raw}"]`,
      });
      if (out.length >= 8) break;
    }
    return out;
  });

  let brokenCount = 0;
  for (const link of linkHrefs) {
    try {
      const res = await page.request.get(link.href, {
        maxRedirects: 5,
        timeout: 8000,
        failOnStatusCode: false,
      });
      const status = res.status();
      if (status >= 400) {
        brokenCount += 1;
        const box = await page
          .locator(link.selector)
          .first()
          .boundingBox()
          .catch(() => null);
        findings.push({
          id: nextId("nav"),
          issue_type: "broken_navigation",
          severity: "error",
          title: link.text || "Navigation link",
          summary: `Link leads to a ${status} page`,
          page: pagePath,
          element: link.selector,
          selector: link.selector,
          rect: box
            ? { x: box.x, y: box.y, width: box.width, height: box.height }
            : undefined,
          evidence: {
            action: "GET",
            request_status: status,
            request_url: link.href,
          },
          suggested_fix:
            "Fix the href to a real route, or add the missing page / redirect.",
          verification: "confirmed",
        });
      }
    } catch {
      /* flake */
    }
  }
  checks.push({
    id: "navigation",
    label: categoryLabel("navigation"),
    status:
      linkHrefs.length === 0 ? "skipped" : brokenCount ? "failed" : "passed",
  });

  // --- 5) Responsive layouts ---
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(200);
  const overflowHit = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= window.innerWidth + 1) return null;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    );
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 10) continue;
      if (rect.right > window.innerWidth + 2) {
        const cls = String(el.className || "")
          .split(/\s+/)
          .filter(Boolean)[0];
        return {
          selector: el.id
            ? `#${el.id}`
            : el.tagName.toLowerCase() + (cls ? `.${cls}` : ""),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          scrollWidth: doc.scrollWidth,
        };
      }
    }
    return {
      selector: "body",
      rect: { x: 0, y: 0, width: doc.scrollWidth, height: 40 },
      scrollWidth: doc.scrollWidth,
    };
  });

  if (overflowHit) {
    findings.push({
      id: nextId("layout"),
      issue_type: "layout_overflow",
      severity: "warning",
      title: "Horizontal overflow",
      summary: "Mobile layout extends off-screen",
      page: pagePath,
      element: overflowHit.selector,
      selector: overflowHit.selector || undefined,
      rect: overflowHit.rect,
      evidence: {
        action: "viewport:375",
        notes: `document.scrollWidth=${overflowHit.scrollWidth} exceeds 375px.`,
      },
      suggested_fix:
        "Find wide fixed-width rows and add wrapping, max-width: 100%, or overflow-x handling under ~640px.",
      verification: "confirmed",
    });
    checks.push({
      id: "responsive_layouts",
      label: categoryLabel("responsive_layouts"),
      status: "failed",
    });
  } else {
    checks.push({
      id: "responsive_layouts",
      label: categoryLabel("responsive_layouts"),
      status: "passed",
    });
  }

  // Restore desktop for axe + screenshot
  await page.setViewportSize({ width: 1280, height: 800 });
  if (page.url() !== startUrl) {
    await page
      .goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch(() => undefined);
  }

  // --- 6) Accessibility — axe-core ---
  let a11yFailed = false;
  try {
    const axe = await runAxeOnPage(page);
    for (const v of axe.violations.slice(0, 8)) {
      a11yFailed = true;
      const node = v.nodes[0];
      const target = node?.target?.[0];
      const selector =
        typeof target === "string"
          ? target
          : Array.isArray(target)
            ? String(target[0])
            : undefined;
      let rect: ElementRect | undefined;
      if (selector) {
        const box = await page
          .locator(selector)
          .first()
          .boundingBox()
          .catch(() => null);
        if (box) rect = { x: box.x, y: box.y, width: box.width, height: box.height };
      }
      findings.push({
        id: nextId("a11y"),
        issue_type: "accessibility",
        severity:
          v.impact === "critical" || v.impact === "serious" ? "error" : "warning",
        title: v.id.replace(/-/g, " "),
        summary: v.help,
        page: pagePath,
        selector,
        element: selector,
        rect,
        evidence: {
          notes: (node?.failureSummary || v.description).slice(0, 280),
        },
        suggested_fix: v.helpUrl
          ? `See ${v.helpUrl}`
          : "Fix the accessibility rule reported by axe-core.",
        verification: "confirmed",
      });
    }
  } catch (err) {
    findings.push({
      id: nextId("a11y"),
      issue_type: "accessibility",
      severity: "info",
      title: "axe-core",
      summary: "Accessibility scan could not run on this page",
      page: pagePath,
      evidence: {
        notes: err instanceof Error ? err.message.slice(0, 200) : "axe failed",
      },
      suggested_fix: "Retry the scan; ensure the page finished loading.",
      verification: "suspected",
    });
    a11yFailed = true;
  }
  checks.push({
    id: "accessibility",
    label: categoryLabel("accessibility"),
    status: a11yFailed ? "failed" : "passed",
  });

  sortChecksByCategory(checks);
}

function sortChecksByCategory(checks: FrontendCheckSummary[]): void {
  const order = FRONTEND_HEALTH_CATEGORIES.map((c) => c.id);
  checks.sort(
    (a, b) =>
      order.indexOf(a.id as (typeof order)[number]) -
      order.indexOf(b.id as (typeof order)[number]),
  );
}

export async function scanFrontendHealth(
  options: ScanOptions = {},
): Promise<FrontendScanResult> {
  const useFixture =
    options.useFixture !== false && !options.targetUrl?.trim();
  const targetUrl = options.targetUrl?.trim() || "fixture:broken-demo";

  const browser = await openLiveBrowser();
  const findings: FrontendFinding[] = [];
  const checks: FrontendCheckSummary[] = [];
  let screenshotBase64: string | null = null;
  let title = "Application";
  let findingSeq = 0;

  try {
    const page = browser.page;
    await page.setViewportSize({ width: 1280, height: 800 });

    const pageErrors: string[] = [];
    const failedRequests: Array<{ url: string; status: number }> = [];

    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        failedRequests.push({ url: res.url(), status: res.status() });
      }
    });

    if (useFixture) {
      await page.setContent(loadBrokenDemoHtml(), {
        waitUntil: "domcontentloaded",
      });
    } else {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    }

    title = (await page.title()) || "Application";
    await page.waitForTimeout(250);

    const pagesScanned: string[] = [];
    if (!useFixture) {
      try {
        pagesScanned.push(new URL(page.url()).pathname || "/");
      } catch {
        pagesScanned.push("/");
      }
      await revealFullPage(page);
    }

    const ctx: ScanCtx = {
      page,
      useFixture,
      targetUrl,
      findings,
      checks,
      pageErrors,
      failedRequests,
      nextId: (prefix) => {
        findingSeq += 1;
        return `${prefix}-${findingSeq}`;
      },
    };

    if (useFixture) {
      await runFixtureChecks(ctx);
    } else {
      await runLiveChecks(ctx);

      // Crawl additional same-origin routes so we don't only check the hero URL
      const extras = await discoverExtraRoutes(page, targetUrl, 5);
      for (const extra of extras) {
        await scanSecondaryPage(ctx, extra);
        try {
          const path = new URL(extra).pathname || "/";
          if (!pagesScanned.includes(path)) pagesScanned.push(path);
        } catch {
          /* ignore */
        }
      }

      // Mark accessibility / runtime failed if secondary pages added issues
      const hasRuntime = findings.some((f) => f.issue_type === "runtime_error");
      const hasA11y = findings.some((f) => f.issue_type === "accessibility");
      for (const c of checks) {
        if (c.id === "runtime_errors" && hasRuntime && c.status === "passed") {
          c.status = "failed";
        }
        if (c.id === "accessibility" && hasA11y && c.status === "passed") {
          c.status = "failed";
        }
        if (
          c.id === "navigation" &&
          findings.some((f) => f.issue_type === "broken_navigation") &&
          c.status === "passed"
        ) {
          c.status = "failed";
        }
      }
    }

    // Capture preview on the entry URL — full page for live, viewport for fixture
    await page.setViewportSize({ width: 1280, height: 800 });
    if (useFixture) {
      await page.setContent(loadBrokenDemoHtml(), {
        waitUntil: "domcontentloaded",
      });
    } else {
      await page.goto(targetUrl, {
        waitUntil: "networkidle",
        timeout: 30_000,
      }).catch(async () => {
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
      });
      await revealFullPage(page);
    }
    await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo(0, 0));

    const annotated = await collectAnnotated(page);
    for (const f of findings) {
      // Only remap rects for findings on the entry page (overlay target)
      if (!f.selector) continue;
      if (!useFixture && f.page && f.page !== pagesScanned[0] && f.page !== "/") {
        // keep existing rect if any; secondary-page overlays aren't on this shot
        continue;
      }
      const byId = f.selector.startsWith("#")
        ? annotated.find((a) => a.selector === f.selector)
        : undefined;
      const match =
        byId ||
        annotated.find(
          (a) =>
            a.selector === f.selector ||
            a.selector === `#${f.selector?.replace("#", "")}`,
        );
      if (match) f.rect = match.rect;
    }

    const fullPage = !useFixture;
    const shot = await page.screenshot({
      type: "png",
      fullPage,
    });
    screenshotBase64 = shot.toString("base64");
    const size = fullPage
      ? await documentSize(page)
      : { width: 1280, height: 800 };

    return {
      targetUrl,
      title,
      viewport: {
        width: Math.min(size.width, 1280),
        height: fullPage ? Math.min(size.height, 12_000) : 800,
      },
      screenshotBase64,
      screenshotFullPage: fullPage,
      pagesScanned: useFixture ? ["/"] : pagesScanned,
      checksCompleted: checks.length,
      checks,
      findings,
      scannedAt: new Date().toISOString(),
      mode: useFixture ? "fixture" : "live",
    };
  } finally {
    if (browser.provider === "local") {
      await browser.page.context().close().catch(() => undefined);
    } else {
      await browser.browser.close().catch(() => undefined);
      if (browser.provider === "browserbase" && browser.remoteSessionId) {
        await closeBrowserbaseRemote(browser.remoteSessionId);
      }
    }
  }
}
