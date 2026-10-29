#!/usr/bin/env node
/**
 * Runtime adapters for the Feature Testing Engine.
 * Browser claims use Playwright. Isolated TS claims use Vitest when a
 * sandbox workspace is present. Integration claims hit the running app.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

function result(status, explanation, extra = {}) {
  return {
    status,
    explanation,
    failing_step: extra.failing_step ?? null,
    source: extra.source ?? null,
    suggested_fix: extra.suggested_fix ?? null,
  };
}

function firstEntry(feature, needles) {
  const routes = (feature.entry_points || []).map((item) => String(item));
  const hit = routes.find((route) =>
    needles.some((needle) => route.toLowerCase().includes(needle)),
  );
  return hit || routes[0] || "/";
}

async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    throw new Error("playwright-core is not installed");
  }
  return chromium.launch({ headless: true });
}

async function runBrowser(test, feature, baseUrl) {
  const origin = baseUrl.replace(/\/$/, "");
  const name = test.name;
  let browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    return result(
      "blocked",
      `Playwright could not launch a browser: ${error instanceof Error ? error.message : error}.`,
      {
        suggested_fix: "Run npx playwright install chromium in the sandbox.",
      },
    );
  }
  const page = await browser.newPage();
  try {
    if (name === "Login page loads") {
      const route = firstEntry(feature, ["login", "signin", "sign-in"]);
      const url = new URL(route, origin).toString();
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      if (!response || response.status() >= 400) {
        return result("fail", `Login page ${url} did not load.`, {
          failing_step: `Open ${url}`,
          source: route,
          suggested_fix: "Confirm the sandbox serves the login route.",
        });
      }
      const visible = await page.locator(
        'form, input[type="password"], text=/sign in|log in|login/i',
      ).first().isVisible().catch(() => false);
      if (!visible) {
        return result("fail", "The login page loaded, but no login form was visible.", {
          failing_step: "Look for a form or password field",
          source: route,
          suggested_fix: "Render a login form on the login route.",
        });
      }
      return result("pass", "The login form is visible in the browser.", {
        source: route,
      });
    }

    if (name === "Invalid credentials rejected") {
      const route = firstEntry(feature, ["login", "signin", "sign-in"]);
      const url = new URL(route, origin).toString();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      const password = page.locator('input[type="password"]').first();
      const email = page
        .locator('input[type="email"], input[name="email"], input[name="username"]')
        .first();
      if (!(await password.count())) {
        return result(
          "inconclusive",
          "No password field was found, so invalid login could not be exercised.",
          { source: route },
        );
      }
      if (await email.count()) {
        await email.fill("nobody@example.invalid");
      }
      await password.fill("wrong-password-for-seethrough");
      const submit = page.locator(
        'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
      ).first();
      if (await submit.count()) {
        await submit.click();
      } else {
        await password.press("Enter");
      }
      await page.waitForTimeout(800);
      const stillPublic = /login|signin|sign-in/i.test(page.url());
      const errorVisible = await page
        .locator("text=/invalid|incorrect|unauthorized|failed/i")
        .first()
        .isVisible()
        .catch(() => false);
      if (stillPublic || errorVisible) {
        return result("pass", "Invalid credentials did not open a private session.", {
          source: route,
        });
      }
      return result(
        "fail",
        "Submitting invalid credentials left the browser on a page that looks authenticated.",
        {
          failing_step: "Submit invalid email and password",
          source: route,
          suggested_fix: "Reject unknown users and keep the session empty.",
        },
      );
    }

    if (name === "Dashboard access protected in the browser") {
      const route =
        (test.intended_routes || [])[0] ||
        firstEntry(feature, ["dashboard", "settings", "admin"]);
      const url = new URL(route, origin).toString();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      const landed = page.url();
      const bounced = /login|signin|sign-in|unauthorized/i.test(landed);
      const forbidden = await page
        .locator("text=/sign in|log in|unauthorized|forbidden/i")
        .first()
        .isVisible()
        .catch(() => false);
      if (bounced || forbidden) {
        return result("pass", "An anonymous visitor was kept off the private route.", {
          source: route,
        });
      }
      return result(
        "inconclusive",
        "The private-looking route loaded without an obvious auth wall. Intended protection is uncertain.",
        {
          failing_step: `Open ${url} signed out`,
          source: route,
          suggested_fix: "Redirect anonymous visitors or mark the route public.",
        },
      );
    }

    if (name === "Create retrieve edit delete") {
      const route = firstEntry(feature, ["dashboard", "admin"]);
      const url = new URL(route, origin).toString();
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      if (!response || response.status() >= 400) {
        return result("fail", `Dashboard ${url} did not load.`, {
          failing_step: `Open ${url}`,
          source: route,
        });
      }
      return result(
        "inconclusive",
        "The dashboard loaded. Create/edit/delete still need fixture data to prove persistence.",
        { source: route },
      );
    }

    return result("inconclusive", "No Playwright flow is registered for this claim.");
  } catch (error) {
    return result(
      "blocked",
      `Playwright stopped: ${error instanceof Error ? error.message : error}.`,
      { suggested_fix: "Confirm the sandbox URL is reachable." },
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function hitApi(baseUrl, pathname, init) {
  const url = new URL(pathname, baseUrl.replace(/\/$/, "") + "/");
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  return { url: url.toString(), status: response.status, response };
}

async function runIntegration(test, feature, baseUrl) {
  if (test.name === "Invalid credentials rejected") {
    const attempts = ["/api/login", "/api/auth/login", "/api/session", "/login"];
    let lastStatus = 0;
    for (const pathname of attempts) {
      try {
        const hit = await hitApi(baseUrl, pathname, {
          method: "POST",
          body: JSON.stringify({
            email: "nobody@example.invalid",
            password: "wrong-password-for-seethrough",
          }),
        });
        lastStatus = hit.status;
        if (hit.status === 404 || hit.status === 405) continue;
        if (hit.status === 401 || hit.status === 403 || hit.status === 422) {
          return result("pass", `Invalid login was rejected by ${hit.url}.`, {
            source: pathname,
          });
        }
        if (hit.status >= 200 && hit.status < 300) {
          return result(
            "fail",
            `Invalid login received ${hit.status} from ${hit.url}.`,
            {
              failing_step: `POST ${pathname} with unknown credentials`,
              source: pathname,
              suggested_fix: "Return 401 and do not create a session.",
            },
          );
        }
      } catch (error) {
        return result(
          "blocked",
          `Could not reach the app API: ${error instanceof Error ? error.message : error}.`,
          { suggested_fix: "Keep the sandbox server running." },
        );
      }
    }
    return result(
      "inconclusive",
      `No login API accepted the request (last status ${lastStatus || "none"}).`,
      { suggested_fix: "Expose a login API or rely on the browser test." },
    );
  }

  if (test.name === "Declined payment handled") {
    return result(
      "inconclusive",
      "A declined-payment API path was not confirmed from the feature files.",
      { suggested_fix: "Point the sandbox at a card-decline fixture." },
    );
  }

  return result("inconclusive", "No integration flow is registered for this claim.");
}

function vitestBin(workspace) {
  const local = path.join(workspace, "node_modules", ".bin", "vitest");
  if (existsSync(local)) return local;
  return null;
}

function runVitest(workspace) {
  const bin = vitestBin(workspace);
  if (!bin) {
    return Promise.resolve(
      result("blocked", "Vitest is not installed in the sandbox workspace.", {
        suggested_fix: "Add Vitest to the isolated checkout, then retry.",
      }),
    );
  }
  return new Promise((resolve) => {
    const child = spawn(bin, ["run", "--reporter=json"], {
      cwd: workspace,
      env: { ...process.env, CI: "1" },
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.on("error", (error) => {
      resolve(
        result("blocked", `Vitest could not start: ${error.message}.`, {
          suggested_fix: "Install Vitest in the sandbox workspace.",
        }),
      );
    });
    child.on("close", (code) => {
      const text = Buffer.concat(stdout).toString("utf8");
      if (code === 0) {
        resolve(result("pass", "Vitest reported a passing isolated suite."));
        return;
      }
      resolve(
        result("fail", "Vitest reported failing isolated tests.", {
          failing_step: "vitest run",
          suggested_fix: text.slice(0, 240) || "Inspect the sandbox Vitest output.",
        }),
      );
    });
  });
}

async function main() {
  let payload;
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.stdout.write(
      JSON.stringify(result("blocked", "Runtime runner received invalid JSON.")) + "\n",
    );
    process.exit(0);
    return;
  }
  const test = payload.test || {};
  const feature = payload.feature || {};
  const baseUrl = String(payload.baseUrl || "").trim();
  const workspace = String(payload.workspace || "").trim();
  const sandbox = Boolean(payload.sandbox);

  if (test.type === "browser") {
    if (!baseUrl) {
      process.stdout.write(
        JSON.stringify(result("blocked", "Playwright needs REPO_SCAN_TEST_BASE_URL.")) +
          "\n",
      );
      return;
    }
    process.stdout.write(JSON.stringify(await runBrowser(test, feature, baseUrl)) + "\n");
    return;
  }

  if (test.type === "integration") {
    if (sandbox && workspace && vitestBin(workspace) && !baseUrl) {
      process.stdout.write(JSON.stringify(await runVitest(workspace)) + "\n");
      return;
    }
    if (!baseUrl) {
      process.stdout.write(
        JSON.stringify(
          result("blocked", "Integration tests need a running app or a Vitest workspace."),
        ) + "\n",
      );
      return;
    }
    process.stdout.write(
      JSON.stringify(await runIntegration(test, feature, baseUrl)) + "\n",
    );
    return;
  }

  process.stdout.write(
    JSON.stringify(result("inconclusive", "Unknown runtime test type.")) + "\n",
  );
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify(
      result("blocked", `Runtime runner crashed: ${error instanceof Error ? error.message : error}.`),
    ) + "\n",
  );
});
