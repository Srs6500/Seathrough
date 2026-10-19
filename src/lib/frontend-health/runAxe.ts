import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { AxeResults } from "axe-core";
import type { Page } from "playwright-core";

/** Resolve packages from the app root so Next bundling cannot corrupt axe.source. */
const requireFromApp = createRequire(join(process.cwd(), "package.json"));

/**
 * Load axe-core's browser IIFE from disk (not the Next/webpack bundle).
 * Bundling axe-core into the server chunk corrupts `.source` and causes
 * `ReferenceError: module is not defined` inside page.evaluate.
 */
function loadAxeSource(): string {
  // Always load via createRequire(cwd) so Turbopack/webpack cannot rewrite axe.source
  // into a CommonJS chunk (that triggers `module is not defined` in the page).
  const axe = requireFromApp("axe-core") as { source?: string };
  if (typeof axe.source === "string" && axe.source.includes("function axeFunction")) {
    return axe.source;
  }

  // Fallback: axe.min.js with a tiny CommonJS shim for the browser
  const minPath = requireFromApp.resolve("axe-core/axe.min.js");
  const min = readFileSync(minPath, "utf8");
  return `
    (function(window){
      var module = { exports: {} };
      var exports = module.exports;
      ${min}
      window.axe = module.exports && module.exports.default
        ? module.exports.default
        : (typeof axe !== "undefined" ? axe : module.exports);
    })(window);
  `;
}

let cachedSource: string | null = null;

function axeSource(): string {
  if (!cachedSource) cachedSource = loadAxeSource();
  return cachedSource;
}

/** Run WCAG 2 A/AA axe-core against the current page. */
export async function runAxeOnPage(page: Page): Promise<AxeResults> {
  return new AxeBuilder({ page, axeSource: axeSource() })
    .withTags(["wcag2a", "wcag2aa"])
    // Legacy mode avoids finishRun blank-page flow; more reliable in Next API.
    .setLegacyMode(true)
    .analyze();
}
