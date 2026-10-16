import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Browser inspector injected into locally-run Next apps. */
export const INSPECTOR_SCRIPT = `(() => {
  if (window.__SEETHROUGH_INSPECTOR__) return;
  window.__SEETHROUGH_INSPECTOR__ = true;

  const STATE = {
    problems: new Map(),
    /** Keys that should paint red (leaf + connected problem comps — not whole layout tree). */
    redKeys: new Set(),
    hoverEl: null,
    shiftDown: false,
    /** Last user-activated element (submit/click) — used to attribute handled API errors. */
    lastActionEl: null,
  };

  const overlayRoot = document.createElement("div");
  overlayRoot.id = "__seethrough-inspector-root";
  overlayRoot.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483646;font-family:ui-sans-serif,system-ui,sans-serif;";
  document.documentElement.appendChild(overlayRoot);

  const toolbar = document.createElement("div");
  toolbar.style.cssText =
    "display:none;position:fixed;z-index:2147483647;pointer-events:auto;gap:4px;align-items:center;";
  toolbar.style.display = "none";

  const inspectBtn = document.createElement("button");
  inspectBtn.type = "button";
  inspectBtn.textContent = "Inspect";
  inspectBtn.title = "Inspect component (or Shift+click the element)";
  inspectBtn.style.cssText =
    "border:0;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:600;background:#111827;color:#fff;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);";

  const shiftBadge = document.createElement("button");
  shiftBadge.type = "button";
  shiftBadge.textContent = "⇧";
  shiftBadge.title = "Hold Shift and click a component to Inspect";
  shiftBadge.style.cssText =
    "border:0;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;background:#334155;color:#fff;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);min-width:22px;";

  toolbar.appendChild(inspectBtn);
  toolbar.appendChild(shiftBadge);
  overlayRoot.appendChild(toolbar);

  const hoverBox = document.createElement("div");
  hoverBox.style.cssText =
    "display:none;position:fixed;pointer-events:none;border:2px solid #22c55e;border-radius:3px;box-sizing:border-box;z-index:2147483645;background:rgba(34,197,94,0.10);";
  overlayRoot.appendChild(hoverBox);

  const redBoxes = new Map();

  function post(payload) {
    try {
      parent.postMessage({ source: "seethrough-inspector", ...payload }, "*");
    } catch (_) {}
  }

  function fiberKey(fiber) {
    if (!fiber) return null;
    const src = fiber._debugSource;
    const name =
      fiber.type?.displayName ||
      fiber.type?.name ||
      fiber.elementType?.displayName ||
      fiber.elementType?.name ||
      "anon";
    if (typeof fiber.type === "string") return null;
    if (src && src.fileName) {
      return src.fileName + ":" + (src.lineNumber || 0) + ":" + name;
    }
    if (typeof name === "string" && name !== "anon") return "component:" + name;
    return null;
  }

  function getFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find(
      (k) =>
        k.startsWith("__reactFiber$") ||
        k.startsWith("__reactInternalInstance$"),
    );
    return key ? el[key] : null;
  }

  function componentChain(startFiber) {
    const chain = [];
    const seen = new Set();
    let f = startFiber;
    while (f) {
      const name =
        f.type?.displayName ||
        f.type?.name ||
        f.elementType?.displayName ||
        f.elementType?.name;
      const src = f._debugSource;
      const key = fiberKey(f);
      if (
        key &&
        typeof name === "string" &&
        /^[A-Z]/.test(name) &&
        !seen.has(key)
      ) {
        seen.add(key);
        chain.push({
          key,
          name,
          file: src?.fileName || null,
          line: src?.lineNumber || null,
          column: src?.columnNumber || null,
        });
      }
      f = f.return;
    }
    return chain;
  }

  /** Nearest (leaf) component only — avoids painting entire app red via Layout. */
  function leafOf(el) {
    const fiber = getFiber(el);
    if (!fiber) return { chain: [], leaf: null };
    const chain = componentChain(fiber);
    return { chain, leaf: chain[0] || null };
  }

  function placeHover(el, color) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      hoverBox.style.display = "none";
      return;
    }
    hoverBox.style.display = "block";
    hoverBox.style.left = rect.left + "px";
    hoverBox.style.top = rect.top + "px";
    hoverBox.style.width = rect.width + "px";
    hoverBox.style.height = rect.height + "px";
    hoverBox.style.borderColor = color === "red" ? "#ef4444" : "#22c55e";
    hoverBox.style.background =
      color === "red" ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.10)";
  }

  function clearRedBoxes() {
    for (const box of redBoxes.values()) box.remove();
    redBoxes.clear();
  }

  function paintPersistentReds() {
    clearRedBoxes();
    if (!STATE.redKeys.size || !document.body) return;
    const nodes = document.body.querySelectorAll("*");
    nodes.forEach((el) => {
      if (overlayRoot.contains(el)) return;
      const { leaf } = leafOf(el);
      if (!leaf || !STATE.redKeys.has(leaf.key)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      // prefer larger leaf hosts — skip tiny wrappers if parent already painted same key
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;pointer-events:none;border:2px solid #ef4444;border-radius:3px;box-sizing:border-box;z-index:2147483644;background:rgba(239,68,68,0.10);";
      box.style.left = rect.left + "px";
      box.style.top = rect.top + "px";
      box.style.width = rect.width + "px";
      box.style.height = rect.height + "px";
      overlayRoot.appendChild(box);
      redBoxes.set(el, box);
    });
  }

  function showToolbar(el) {
    const rect = el.getBoundingClientRect();
    toolbar.style.display = "flex";
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - 100));
    const top = Math.max(4, rect.top - 26);
    toolbar.style.left = left + "px";
    toolbar.style.top = top + "px";
    shiftBadge.style.background = STATE.shiftDown ? "#2563eb" : "#334155";
    STATE.hoverEl = el;
  }

  function hideToolbar() {
    toolbar.style.display = "none";
    hoverBox.style.display = "none";
    STATE.hoverEl = null;
  }

  function markProblemFromError(message, stack) {
    const text = (stack || "") + "\\n" + (message || "");
    // Ignore noisy Next/React internals
    if (/hydrat|Fast Refresh|Download the React DevTools|warning/i.test(text)) {
      return;
    }
    const fileMatch = text.match(
      /(?:\\(|at\\s+)?((?:\\/[\\w@.-]+)+\\.(?:tsx?|jsx?)):(\\d+)(?::(\\d+))?/,
    );
    let file = fileMatch?.[1] || null;
    let line = fileMatch ? Number(fileMatch[2]) : null;
    if (file && file.includes("/.next/")) file = null;
    const compMatch = text.match(/at\\s+([A-Z][A-Za-z0-9_]*)\\s/);
    const compName = compMatch?.[1] || null;
    // Skip ultra-generic roots that would paint the whole tree
    if (
      compName &&
      /^(Root|App|Layout|RootLayout|Template|NotFound|Error|RedirectErrorBoundary|DevRoot|HotReload)$/.test(
        compName,
      )
    ) {
      return;
    }
    const key = file
      ? file + ":" + (line || 0) + ":" + (compName || "anon")
      : compName
        ? "component:" + compName
        : null;
    if (!key) return;

    STATE.problems.set(key, {
      key,
      message: String(message || "Error"),
      stack: stack || "",
      file,
      line,
      name: compName,
    });
    STATE.redKeys.add(key);
    if (compName) STATE.redKeys.add("component:" + compName);
    post({ type: "problem", problem: STATE.problems.get(key) });
    paintPersistentReds();
  }

  function runInspect(el) {
    if (!el) return;
    const { chain, leaf } = leafOf(el);
    if (!chain.length || !leaf) {
      post({
        type: "inspect",
        chain: [],
        note: "No React component source found. Use next dev so _debugSource is available.",
      });
      return;
    }

    const connected = chain.map((item) => {
      let hit = null;
      for (const problem of STATE.problems.values()) {
        const fileBase = item.file ? item.file.split("/").pop() : null;
        const problemBase = problem.file
          ? String(problem.file).split("/").pop()
          : null;
        if (
          problem.key === item.key ||
          (problem.name && problem.name === item.name) ||
          (fileBase && problemBase && fileBase === problemBase)
        ) {
          hit = problem;
          break;
        }
      }
      return { ...item, problem: hit };
    });

    // Red = leaf + any chain items that actually have problems (not blank ancestors)
    STATE.redKeys = new Set();
    for (const item of connected) {
      if (item.problem || item.key === leaf.key) {
        STATE.redKeys.add(item.key);
        STATE.redKeys.add("component:" + item.name);
      }
    }
    // If leaf has a problem, also mark later chain members that share same problem file/name
    const leafHit = connected.find((c) => c.key === leaf.key);
    if (leafHit?.problem) {
      for (const item of connected) {
        if (
          item.problem ||
          (leafHit.problem.name && item.name === leafHit.problem.name)
        ) {
          STATE.redKeys.add(item.key);
        }
      }
    }

    const focus =
      connected.find((c) => c.problem) || leafHit || connected[0];

    post({
      type: "inspect",
      chain: connected,
      leaf: focus,
      problems: [...STATE.problems.values()],
    });
    paintPersistentReds();
    placeHover(el, "red");
  }

  inspectBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    runInspect(STATE.hoverEl);
  });

  shiftBadge.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    runInspect(STATE.hoverEl);
  });

  document.addEventListener(
    "mousemove",
    (event) => {
      const el = event.target;
      if (!(el instanceof Element) || overlayRoot.contains(el)) return;
      const { leaf } = leafOf(el);
      if (!leaf) {
        hideToolbar();
        return;
      }
      const isRed =
        STATE.redKeys.has(leaf.key) ||
        STATE.redKeys.has("component:" + leaf.name) ||
        STATE.problems.has(leaf.key);
      placeHover(el, isRed ? "red" : "green");
      showToolbar(el);
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!STATE.shiftDown) return;
      const el = event.target;
      if (!(el instanceof Element) || overlayRoot.contains(el)) return;
      const { leaf } = leafOf(el);
      if (!leaf) return;
      event.preventDefault();
      event.stopPropagation();
      STATE.hoverEl = el;
      runInspect(el);
    },
    true,
  );

  window.addEventListener("keydown", (event) => {
    if (event.key === "Shift") {
      STATE.shiftDown = true;
      shiftBadge.style.background = "#2563eb";
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Shift") {
      STATE.shiftDown = false;
      shiftBadge.style.background = "#334155";
    }
  });

  window.addEventListener("error", (event) => {
    markProblemFromError(event.message, event.error?.stack || "");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    markProblemFromError(
      reason?.message || String(reason),
      reason?.stack || "",
    );
  });

  function markProblemOnElement(el, message, meta) {
    if (!el || !(el instanceof Element)) return;
    const { chain, leaf } = leafOf(el);
    const target = leaf || chain[0];
    if (!target) return;
    const key = target.key;
    STATE.problems.set(key, {
      key,
      message: String(message || "UI error"),
      stack: meta?.stack || "",
      file: target.file,
      line: target.line,
      name: target.name,
      kind: meta?.kind || "ui",
    });
    STATE.redKeys.add(key);
    STATE.redKeys.add("component:" + target.name);
    // Also mark form ancestors (not RootLayout) so the form cluster goes red
    for (const item of chain.slice(0, 4)) {
      if (/^(Root|App|Layout|RootLayout|Template)$/.test(item.name)) continue;
      STATE.redKeys.add(item.key);
      STATE.redKeys.add("component:" + item.name);
    }
    post({ type: "problem", problem: STATE.problems.get(key) });
    paintPersistentReds();
  }

  // Track clicks/submits so failed fetch can be attributed to the form UI
  document.addEventListener(
    "click",
    (event) => {
      const el = event.target;
      if (el instanceof Element && !overlayRoot.contains(el)) {
        STATE.lastActionEl = el;
      }
    },
    true,
  );
  document.addEventListener(
    "submit",
    (event) => {
      const el = event.target;
      if (el instanceof Element) STATE.lastActionEl = el;
    },
    true,
  );

  // Handled API failures never throw — patch fetch to catch them
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    try {
      const res = await origFetch(...args);
      if (!res.ok && res.status >= 400) {
        const url =
          typeof args[0] === "string"
            ? args[0]
            : args[0] && args[0].url
              ? args[0].url
              : "(request)";
        markProblemOnElement(
          STATE.lastActionEl || document.activeElement,
          "Request failed " + res.status + " " + res.statusText + " — " + url,
          { kind: "network", stack: "fetch " + url + " → " + res.status },
        );
      }
      return res;
    } catch (error) {
      markProblemOnElement(
        STATE.lastActionEl || document.activeElement,
        error && error.message ? error.message : "Network request failed",
        { kind: "network", stack: error && error.stack ? error.stack : "" },
      );
      throw error;
    }
  };

  // Visible handled errors: "Something went wrong…" banners, role=alert, etc.
  const ERROR_TEXT =
    /something went wrong|please try again|failed to|error|unable to|submission failed|invalid|required/i;

  function looksLikeErrorNode(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (overlayRoot.contains(el)) return false;
    const role = el.getAttribute("role");
    const live = el.getAttribute("aria-live");
    const cls = (el.className && String(el.className)) || "";
    const text = (el.textContent || "").trim();
    if (text.length < 3 || text.length > 280) return false;
    if (role === "alert" || live === "assertive" || live === "polite") {
      return ERROR_TEXT.test(text) || text.length > 0;
    }
    if (
      /error|danger|destructive|alert|toast/i.test(cls) &&
      ERROR_TEXT.test(text)
    ) {
      return true;
    }
    if (ERROR_TEXT.test(text) && /went wrong|try again|failed/i.test(text)) {
      return true;
    }
    return false;
  }

  function scanErrorBanners() {
    if (!document.body) return;
    const candidates = document.body.querySelectorAll(
      "[role='alert'], [aria-live], [class*='error'], [class*='Error'], [class*='danger'], [class*='alert'], [class*='destructive']",
    );
    candidates.forEach((el) => {
      if (!looksLikeErrorNode(el)) return;
      const text = (el.textContent || "").trim().slice(0, 160);
      // Prefer attributing to the form that was just submitted
      const host =
        STATE.lastActionEl ||
        el.closest("form") ||
        el.parentElement ||
        el;
      markProblemOnElement(host, text, { kind: "ui-banner" });
    });
  }

  const mo = new MutationObserver(() => {
    window.clearTimeout(scanErrorBanners._t);
    scanErrorBanners._t = window.setTimeout(scanErrorBanners, 150);
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  setTimeout(scanErrorBanners, 800);

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "seethrough-parent") return;
    if (data.type === "set-problems" && Array.isArray(data.problems)) {
      STATE.problems.clear();
      STATE.redKeys.clear();
      for (const p of data.problems) {
        if (p && p.key) {
          STATE.problems.set(p.key, p);
          STATE.redKeys.add(p.key);
          if (p.name) STATE.redKeys.add("component:" + p.name);
        }
      }
      paintPersistentReds();
    }
    if (data.type === "clear-selection") {
      STATE.redKeys.clear();
      clearRedBoxes();
      hideToolbar();
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (STATE.hoverEl) {
        const { leaf } = leafOf(STATE.hoverEl);
        const isRed =
          leaf &&
          (STATE.redKeys.has(leaf.key) ||
            STATE.redKeys.has("component:" + leaf.name));
        placeHover(STATE.hoverEl, isRed ? "red" : "green");
        showToolbar(STATE.hoverEl);
      }
      paintPersistentReds();
    },
    true,
  );
  window.addEventListener("resize", () => paintPersistentReds());

  post({ type: "ready" });
})();
`;

async function findLayoutFile(workDir: string): Promise<string | null> {
  const candidates = [
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    "app/layout.tsx",
    "app/layout.jsx",
    "src/pages/_app.tsx",
    "src/pages/_app.jsx",
    "pages/_app.tsx",
    "pages/_app.jsx",
  ];
  for (const rel of candidates) {
    try {
      await readFile(path.join(workDir, rel), "utf8");
      return rel;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Copy inspector into the run directory and patch the root layout/app. */
export async function injectInspector(workDir: string): Promise<string> {
  const publicDir = path.join(workDir, "public", "__seethrough");
  await mkdir(publicDir, { recursive: true });
  await writeFile(
    path.join(publicDir, "inspector.js"),
    INSPECTOR_SCRIPT,
    "utf8",
  );

  const layoutRel = await findLayoutFile(workDir);
  if (!layoutRel) {
    return "Wrote public/__seethrough/inspector.js (no layout/_app found to patch).";
  }

  const layoutPath = path.join(workDir, layoutRel);
  let source = await readFile(layoutPath, "utf8");
  if (source.includes("__seethrough/inspector.js")) {
    // Refresh script file even if layout already patched
    return `Updated inspector.js (layout already patched: ${layoutRel})`;
  }

  if (
    !source.includes('from "next/script"') &&
    !source.includes("from 'next/script'")
  ) {
    source = `import Script from "next/script";\n${source}`;
  }

  const scriptJsx = `<Script src="/__seethrough/inspector.js" strategy="afterInteractive" />`;

  if (source.includes("{children}")) {
    source = source.replace(
      "{children}",
      `${scriptJsx}\n        {children}`,
    );
  } else if (source.includes("<Component")) {
    source = source.replace(
      "<Component",
      `<>\n      ${scriptJsx}\n      <Component`,
    );
    if (!source.includes("</>")) {
      const idx = source.lastIndexOf(");");
      if (idx >= 0) {
        source = `${source.slice(0, idx)}</>\n    ${source.slice(idx)}`;
      }
    }
  } else {
    return `Wrote inspector.js; could not auto-patch ${layoutRel} — add Script manually.`;
  }

  await writeFile(layoutPath, source, "utf8");
  return `Injected inspector into ${layoutRel}`;
}
