import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const html = readFileSync(
  path.join(process.cwd(), "fixtures/frontend-health/broken-demo.html"),
  "utf8",
);

assert.match(html, /id="submit-btn"/);
assert.match(html, /id="broken-nav"/);
assert.match(html, /id="hero-image"/);
assert.match(html, /id="mobile-menu"/);
assert.match(html, /data-st-source="src\/components\/ContactForm\.tsx:42"/);
assert.match(html, /__missingContactApi/);
assert.ok(!/alt=/.test(html.match(/id="hero-image"[\s\S]*?>/)?.[0] ?? "alt="));

console.log("frontend-health fixture markers ok");

async function runBrowserScan() {
  const { scanFrontendHealth } = await import(
    "../src/lib/frontend-health/scan"
  );
  const result = await scanFrontendHealth({ useFixture: true });

  assert.equal(result.mode, "fixture");
  assert.ok(result.checksCompleted >= 6, "expected six category checks");
  const checkIds = new Set(result.checks.map((c) => c.id));
  for (const id of [
    "buttons_interactions",
    "forms",
    "navigation",
    "runtime_errors",
    "responsive_layouts",
    "accessibility",
  ]) {
    assert.ok(checkIds.has(id), `missing category ${id}`);
  }
  assert.ok(
    result.findings.length >= 3,
    `expected ≥3 findings, got ${result.findings.length}`,
  );
  assert.ok(result.screenshotBase64, "screenshot required");

  const types = new Set(result.findings.map((f) => f.issue_type));
  assert.ok(types.has("runtime_error"), "runtime crash");
  assert.ok(types.has("broken_navigation"), "broken nav");
  assert.ok(
    types.has("form_validation") ||
      types.has("accessibility") ||
      types.has("layout_overflow"),
    "form/a11y/layout finding",
  );

  const withSource = result.findings.filter(
    (f) => f.source_file && f.source_line,
  );
  assert.ok(withSource.length >= 2, "source mapping via data-st-source");

  const withRect = result.findings.filter((f) => f.rect && f.rect.width > 0);
  assert.ok(withRect.length >= 2, "element rects for highlights");

  const a11y = result.checks.find((c) => c.id === "accessibility");
  assert.ok(a11y, "accessibility category present");
  assert.notEqual(
    a11y?.status,
    "skipped",
    "accessibility should run on the fixture",
  );
  assert.ok(
    !result.findings.some((f) =>
      /module is not defined|could not run/i.test(
        `${f.summary} ${f.evidence.notes || ""}`,
      ),
    ),
    "axe-core must inject without module/CJS errors",
  );

  console.log(
    `frontend-health smoke passed · ${result.findings.length} findings · ${result.checksCompleted} checks`,
  );
  // Shared Chromium keeps the event loop alive — exit explicitly after assertions.
  process.exit(0);
}

runBrowserScan().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /Executable doesn't exist|Local browser failed|ENOSPC|Chromium/i.test(
      message,
    )
  ) {
    console.log(
      "frontend-health browser scan skipped (Chromium unavailable on this machine).",
    );
    console.log(message.slice(0, 200));
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});
