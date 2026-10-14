import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";
import {
  applyAnnotation,
  closeHandle,
  gotoSafe,
  type LiveBrowserHandle,
} from "@/lib/browser-experience/driver";
import {
  closeBrowserbaseRemote,
  refreshBrowserbaseLiveView,
} from "@/lib/browser-experience/browserbase";
import { mintLiveViewUrl } from "@/lib/browser-experience/browserless";
import { detectBrowserChallenge } from "@/lib/browser-experience/challenge";
import {
  faviconForUrl,
  resolveOmniboxTarget,
  tabTitleFrom,
  toPublicTab,
} from "@/lib/browser-experience/tabs";
import type {
  BrowserAnnotation,
  BrowserChatMessage,
  BrowserLessonMatrix,
  BrowserLessonRole,
  BrowserProvider,
  BrowserSessionPublic,
  BrowserSessionStatus,
  BrowserTabKind,
  BrowserTabPublic,
  BrowserTeachBeat,
} from "@/lib/browser-experience/types";
import { openYouTubeLesson } from "@/lib/browser-experience/youtube";
import type { LessonSource } from "@/types/lesson";

export type BrowserTabRecord = {
  id: string;
  title: string;
  url: string;
  faviconUrl: string | null;
  kind: BrowserTabKind;
  role: "ground" | "truth" | null;
  source: LessonSource | null;
  page: Page;
};

export type BrowserSessionRecord = {
  id: string;
  provider: BrowserProvider;
  remoteSessionId?: string;
  liveViewUrl: string | null;
  currentUrl: string;
  addressBar: string;
  status: BrowserSessionStatus;
  question: string;
  selectedSource: LessonSource | null;
  sources: LessonSource[];
  title: string | null;
  pageText: string;
  beats: BrowserTeachBeat[];
  history: BrowserChatMessage[];
  isYouTube: boolean;
  matrix: BrowserLessonMatrix | null;
  tabs: BrowserTabRecord[];
  activeTabId: string | null;
  userControl: boolean;
  challengeReason: string | null;
  /** Status before entering awaiting_user (for resume). */
  statusBeforeControl: BrowserSessionStatus | null;
  createdAt: number;
  updatedAt: number;
  handle: LiveBrowserHandle;
};

type Store = Map<string, BrowserSessionRecord>;

const GLOBAL_KEY = "__seethrough_browser_sessions__";

function store(): Store {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Store };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

function syncActivePage(session: BrowserSessionRecord, page: Page): void {
  session.handle.page = page;
}

function refreshTabMeta(tab: BrowserTabRecord): void {
  const url = tab.page.url() || tab.url || "about:blank";
  tab.url = url;
  tab.faviconUrl = faviconForUrl(url);
  tab.title = tabTitleFrom(tab.title, url, tab.title || "New Tab");
}

export function publicTabs(session: BrowserSessionRecord): BrowserTabPublic[] {
  return session.tabs.map((tab) => {
    refreshTabMeta(tab);
    return toPublicTab(tab);
  });
}

export function createSessionRecord(
  handle: LiveBrowserHandle,
  question: string,
): BrowserSessionRecord {
  const id = randomUUID();
  const now = Date.now();
  const tabId = randomUUID();
  const firstTab: BrowserTabRecord = {
    id: tabId,
    title: "New Tab",
    url: "about:blank",
    faviconUrl: null,
    kind: "blank",
    role: null,
    source: null,
    page: handle.page,
  };
  const record: BrowserSessionRecord = {
    id,
    provider: handle.provider,
    remoteSessionId: handle.remoteSessionId,
    liveViewUrl: handle.liveViewUrl,
    currentUrl: "about:blank",
    addressBar: "about:blank",
    status: "starting",
    question,
    selectedSource: null,
    sources: [],
    title: null,
    pageText: "",
    beats: [],
    history: [{ role: "user", content: question }],
    isYouTube: false,
    matrix: null,
    tabs: [firstTab],
    activeTabId: tabId,
    userControl: false,
    challengeReason: null,
    statusBeforeControl: null,
    createdAt: now,
    updatedAt: now,
    handle,
  };
  store().set(id, record);
  return record;
}

export function getSession(sessionId: string): BrowserSessionRecord | null {
  return store().get(sessionId) ?? null;
}

export function requireSession(sessionId: string): BrowserSessionRecord {
  const session = getSession(sessionId);
  if (!session || session.status === "closed") {
    throw new Error("Session not found");
  }
  return session;
}

export function toPublicSession(
  session: BrowserSessionRecord,
): BrowserSessionPublic {
  const tabs = publicTabs(session);
  return {
    id: session.id,
    provider: session.provider,
    liveViewUrl: session.liveViewUrl,
    // Local: always stream frames (headed window is the click target).
    // Cloud + Take control: LiveURL iframe only (JPEG isn't clickable).
    // Cloud + agent: frames until LiveURL exists.
    frameStream:
      session.provider === "local"
        ? true
        : session.userControl
          ? false
          : !session.liveViewUrl,
    currentUrl: session.currentUrl,
    addressBar: session.addressBar,
    status: session.status,
    question: session.question,
    selectedSource: session.selectedSource,
    sources: session.sources,
    title: session.title,
    beats: session.beats,
    history: session.history,
    isYouTube: session.isYouTube,
    matrix: session.matrix,
    tabs,
    activeTabId: session.activeTabId,
    userControl: session.userControl,
    challengeReason: session.challengeReason,
  };
}

export function touchSession(
  session: BrowserSessionRecord,
  patch: Partial<
    Omit<BrowserSessionRecord, "id" | "handle" | "createdAt" | "provider">
  >,
): BrowserSessionRecord {
  Object.assign(session, patch, { updatedAt: Date.now() });
  store().set(session.id, session);
  return session;
}

export function sessionPage(session: BrowserSessionRecord): Page {
  const active =
    session.tabs.find((t) => t.id === session.activeTabId) ?? session.tabs[0];
  if (active) {
    syncActivePage(session, active.page);
    return active.page;
  }
  return session.handle.page;
}

function findTab(
  session: BrowserSessionRecord,
  tabId: string,
): BrowserTabRecord | null {
  return session.tabs.find((t) => t.id === tabId) ?? null;
}

async function syncAddressFromActive(
  session: BrowserSessionRecord,
): Promise<void> {
  const page = sessionPage(session);
  const url = page.url() || "about:blank";
  const active = session.tabs.find((t) => t.id === session.activeTabId);
  if (active) {
    active.url = url;
    active.faviconUrl = faviconForUrl(url);
    try {
      active.title = tabTitleFrom(await page.title(), url, active.title);
    } catch {
      active.title = tabTitleFrom(active.title, url, "New Tab");
    }
  }
  touchSession(session, {
    currentUrl: url,
    addressBar: url,
  });
}

/** Bring an existing tab to the front (Live View + frames follow it). */
export async function activateSessionTab(
  sessionId: string,
  tabId: string,
): Promise<BrowserSessionRecord> {
  const session = requireSession(sessionId);
  const tab = findTab(session, tabId);
  if (!tab) throw new Error("Tab not found");

  const previous = session.tabs.find((t) => t.id === session.activeTabId);
  if (previous && previous.id !== tab.id) {
    await applyAnnotation(previous.page, { kind: "clear" }).catch(() => undefined);
  }

  await tab.page.bringToFront().catch(() => undefined);
  session.activeTabId = tab.id;
  syncActivePage(session, tab.page);
  await syncAddressFromActive(session);

  if (tab.role && session.matrix) {
    touchSession(session, {
      matrix: { ...session.matrix, activeRole: tab.role },
      selectedSource: tab.source,
      title: tab.title,
      isYouTube: Boolean(tab.kind === "ground" && tab.source),
    });
  }

  return requireSession(sessionId);
}

type OpenTabOptions = {
  kind: BrowserTabKind;
  role?: "ground" | "truth" | null;
  source?: LessonSource | null;
  title?: string;
  /** When true, reuse the single blank/search starter tab instead of newPage. */
  reuseStarter?: boolean;
  /** Navigate with gotoSafe to this URL (skipped if `load` is provided). */
  url?: string;
  /** Custom loader (e.g. YouTube open). */
  load?: (page: Page) => Promise<{ url: string; title?: string }>;
};

/**
 * Open a real Playwright page as a new browser tab (or reuse the starter tab).
 */
export async function openSessionTab(
  session: BrowserSessionRecord,
  options: OpenTabOptions,
): Promise<BrowserTabRecord> {
  const starter =
    options.reuseStarter &&
    session.tabs.length === 1 &&
    (session.tabs[0]!.kind === "blank" || session.tabs[0]!.kind === "search")
      ? session.tabs[0]!
      : null;

  let page: Page;
  let tab: BrowserTabRecord;

  if (starter) {
    page = starter.page;
    tab = starter;
    tab.kind = options.kind;
    tab.role = options.role ?? null;
    tab.source = options.source ?? null;
    if (options.title) tab.title = options.title;
  } else {
    const context = session.handle.page.context();
    page = await context.newPage();
    const viewport = session.handle.page.viewportSize();
    if (viewport) {
      await page.setViewportSize(viewport).catch(() => undefined);
    }
    tab = {
      id: randomUUID(),
      title: options.title || "New Tab",
      url: "about:blank",
      faviconUrl: null,
      kind: options.kind,
      role: options.role ?? null,
      source: options.source ?? null,
      page,
    };
    session.tabs.push(tab);
  }

  session.activeTabId = tab.id;
  syncActivePage(session, page);
  await page.bringToFront().catch(() => undefined);

  try {
    if (options.load) {
      const loaded = await options.load(page);
      tab.url = loaded.url;
      tab.title = tabTitleFrom(
        loaded.title || options.title,
        loaded.url,
        options.title || "New Tab",
      );
    } else if (options.url) {
      await gotoSafe(page, options.url, { timeoutMs: 40_000 });
      tab.url = page.url();
      try {
        tab.title = tabTitleFrom(
          await page.title(),
          tab.url,
          options.title || options.source?.title || "New Tab",
        );
      } catch {
        tab.title = tabTitleFrom(
          options.title || options.source?.title,
          tab.url,
          "New Tab",
        );
      }
    } else {
      tab.url = page.url() || "about:blank";
      tab.title = options.title || "New Tab";
    }
  } catch (error) {
    // If a brand-new page failed to load, drop it so we don't leak dead tabs.
    if (!starter) {
      session.tabs = session.tabs.filter((t) => t.id !== tab.id);
      await page.close().catch(() => undefined);
      const fallback = session.tabs[session.tabs.length - 1] ?? session.tabs[0];
      if (fallback) {
        session.activeTabId = fallback.id;
        syncActivePage(session, fallback.page);
      }
    }
    throw error;
  }

  tab.faviconUrl = faviconForUrl(tab.url);
  touchSession(session, {
    currentUrl: tab.url,
    addressBar: tab.url,
    selectedSource: options.source ?? session.selectedSource,
  });
  return tab;
}

/** Close a tab (keeps at least one). Activates a neighbor when needed. */
export async function closeSessionTab(
  sessionId: string,
  tabId: string,
): Promise<BrowserSessionRecord> {
  const session = requireSession(sessionId);
  if (!session.userControl) {
    throw new Error("Take control first to close a tab.");
  }
  if (session.tabs.length <= 1) {
    throw new Error("Keep at least one tab open.");
  }
  const index = session.tabs.findIndex((t) => t.id === tabId);
  if (index < 0) throw new Error("Tab not found");
  const [removed] = session.tabs.splice(index, 1);
  if (removed) {
    await removed.page.close().catch(() => undefined);
  }
  const next =
    session.tabs[Math.min(index, session.tabs.length - 1)] ?? session.tabs[0]!;
  session.activeTabId = next.id;
  syncActivePage(session, next.page);
  await next.page.bringToFront().catch(() => undefined);
  await syncAddressFromActive(session);
  return requireSession(sessionId);
}

/** Open a Muse-style new tab on Google so the user can search immediately. */
export async function openBlankSessionTab(
  sessionId: string,
): Promise<BrowserSessionRecord> {
  const session = requireSession(sessionId);
  if (!session.userControl) {
    throw new Error("Take control first to open a new tab.");
  }
  await openSessionTab(session, {
    kind: "search",
    title: "Google",
    url: "https://www.google.com/",
  });
  return requireSession(sessionId);
}

/** Omnibox navigate on the active tab (URL or Google search query). */
export async function navigateSessionOmnibox(
  sessionId: string,
  raw: string,
): Promise<BrowserSessionRecord> {
  const session = requireSession(sessionId);
  if (!session.userControl) {
    throw new Error("Take control first to search or open a URL.");
  }
  const target = resolveOmniboxTarget(raw);
  const page = sessionPage(session);
  await gotoSafe(page, target, { timeoutMs: 40_000 });
  const active = session.tabs.find((t) => t.id === session.activeTabId);
  if (active) {
    active.url = page.url();
    active.faviconUrl = faviconForUrl(active.url);
    try {
      active.title = tabTitleFrom(await page.title(), active.url, "Search");
    } catch {
      active.title = tabTitleFrom(raw, active.url, "Search");
    }
    if (active.kind === "blank") active.kind = "search";
  }
  await syncAddressFromActive(session);
  return requireSession(sessionId);
}

/** Reload the active tab (Take control). */
export async function reloadSessionTab(
  sessionId: string,
): Promise<BrowserSessionRecord> {
  const session = requireSession(sessionId);
  if (!session.userControl) {
    throw new Error("Take control first to reload.");
  }
  const page = sessionPage(session);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 40_000 }).catch(
    () => undefined,
  );
  await syncAddressFromActive(session);
  return requireSession(sessionId);
}

/** Close every tab except one blank starter (used when starting a new ask). */
export async function resetSessionTabs(
  session: BrowserSessionRecord,
): Promise<void> {
  const keep = session.tabs[0];
  if (!keep) return;
  for (const tab of session.tabs.slice(1)) {
    await tab.page.close().catch(() => undefined);
  }
  keep.kind = "blank";
  keep.role = null;
  keep.source = null;
  keep.title = "New Tab";
  keep.url = "about:blank";
  keep.faviconUrl = null;
  session.tabs = [keep];
  session.activeTabId = keep.id;
  syncActivePage(session, keep.page);
  try {
    await keep.page.goto("about:blank", { waitUntil: "domcontentloaded" });
  } catch {
    /* ignore */
  }
  await keep.page.bringToFront().catch(() => undefined);
  touchSession(session, {
    currentUrl: "about:blank",
    addressBar: "about:blank",
  });
}

/**
 * Formerly closed non-winner probe tabs. Muse-style: keep every opened
 * source tab in the strip even when teach only uses Ground/Truth.
 * `keepTabIds` is accepted for call-site compatibility (unused).
 */
export async function pruneProbeTabs(
  session: BrowserSessionRecord,
  _keepTabIds: Set<string>,
): Promise<void> {
  void _keepTabIds;
  // Ensure the active tab still exists; never close sibling source tabs.
  if (!session.tabs.some((t) => t.id === session.activeTabId)) {
    const next = session.tabs[session.tabs.length - 1] ?? session.tabs[0];
    if (next) {
      session.activeTabId = next.id;
      syncActivePage(session, next.page);
      await next.page.bringToFront().catch(() => undefined);
    }
  }
  touchSession(session, {});
}

/** Promote a tab to a matrix role and optionally demote siblings of that role. */
export function pinTabRole(
  session: BrowserSessionRecord,
  tabId: string,
  role: "ground" | "truth",
  source: LessonSource | null,
): BrowserTabRecord | null {
  const tab = findTab(session, tabId);
  if (!tab) return null;
  for (const other of session.tabs) {
    if (other.id !== tabId && other.role === role) {
      other.role = null;
      if (other.kind === role) other.kind = "source";
    }
  }
  tab.role = role;
  tab.kind = role;
  tab.source = source;
  return tab;
}

/** Forward human input onto the live page while Take control is active. */
export async function dispatchSessionInput(
  sessionId: string,
  input: {
    type: "click" | "dblclick" | "type" | "key";
    xNorm?: number;
    yNorm?: number;
    text?: string;
    key?: string;
  },
): Promise<void> {
  const session = requireSession(sessionId);
  if (!session.userControl) {
    throw new Error("Take control first, then click in the browser pane.");
  }
  const page = sessionPage(session);
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };

  if (input.type === "click" || input.type === "dblclick") {
    const xNorm = input.xNorm ?? 0.5;
    const yNorm = input.yNorm ?? 0.5;
    const x = Math.max(0, Math.min(viewport.width - 1, xNorm * viewport.width));
    const y = Math.max(
      0,
      Math.min(viewport.height - 1, yNorm * viewport.height),
    );
    // Move then click — more reliable for reCAPTCHA checkboxes than click-only.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    if (input.type === "dblclick") {
      await page.mouse.down();
      await page.mouse.up();
    }
    await syncAddressFromActive(session);
    return;
  }

  if (input.type === "type" && input.text) {
    await page.keyboard.type(input.text, { delay: 15 });
    return;
  }

  if (input.type === "key" && input.key) {
    await page.keyboard.press(input.key);
    await syncAddressFromActive(session);
  }
}

export async function annotateSession(
  sessionId: string,
  annotation: BrowserAnnotation,
) {
  const session = requireSession(sessionId);
  if (session.userControl) {
    throw new Error(
      "You’re in control of the browser. Finish the check, then click Resume.",
    );
  }
  try {
    return await applyAnnotation(sessionPage(session), annotation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/Execution context was destroyed|navigation/i.test(message)) {
      return { ok: false, reason: "page_navigating" };
    }
    throw error;
  }
}

/**
 * Ensure an embeddable live view exists.
 * Reuse the current LiveURL when possible — reminting closes the viewer
 * ("All done! You can safely close this window") and blanks the iframe.
 */
async function ensureInteractiveLiveView(
  session: BrowserSessionRecord,
  opts?: { forceRemint?: boolean },
): Promise<void> {
  if (session.liveViewUrl && !opts?.forceRemint) return;

  const page = sessionPage(session);
  if (session.provider === "browserless") {
    const liveViewUrl = await mintLiveViewUrl(page);
    if (liveViewUrl) {
      session.handle.liveViewUrl = liveViewUrl;
      touchSession(session, { liveViewUrl });
    }
    return;
  }
  if (session.provider === "browserbase" && session.remoteSessionId) {
    const liveViewUrl = await refreshBrowserbaseLiveView(
      session.remoteSessionId,
    );
    if (liveViewUrl) {
      session.handle.liveViewUrl = liveViewUrl;
      touchSession(session, { liveViewUrl });
    }
  }
}

/** Hand the live browser to the human (CAPTCHA / Google sign-in / manual). */
export async function takeSessionControl(
  sessionId: string,
  reason?: string,
): Promise<BrowserSessionRecord> {
  const session = requireSession(sessionId);
  const statusBefore =
    session.status === "awaiting_user"
      ? session.statusBeforeControl
      : session.status;

  const defaultReason =
    session.provider === "local"
      ? "You’re in control — click and type in the browser pane below (CAPTCHA / Google sign-in), then Resume."
      : "You’re in control — click and type in the live browser below (CAPTCHA / Google sign-in), then Resume.";

  await syncAddressFromActive(session);
  touchSession(session, {
    userControl: true,
    challengeReason:
      reason?.trim() || session.challengeReason || defaultReason,
    statusBeforeControl:
      statusBefore && statusBefore !== "closed" ? statusBefore : "teaching",
    status: "awaiting_user",
  });

  // Local headed Chromium: desktop window is the interactive surface (no LiveURL).
  if (session.provider === "local") {
    await sessionPage(session).bringToFront().catch(() => undefined);
    return requireSession(sessionId);
  }

  // Cloud: mint LiveURL once on take. Do not remint (All done / Session ended UX).
  await ensureInteractiveLiveView(session, { forceRemint: false });
  const live = requireSession(sessionId);
  if (!live.liveViewUrl) {
    await ensureInteractiveLiveView(live, { forceRemint: true });
  }
  const again = requireSession(sessionId);
  if (!again.liveViewUrl) {
    throw new Error(
      "Could not open an interactive live view. Prefer local Chromium for long Take-control drills, or check Browserless/Browserbase.",
    );
  }
  return again;
}

/** Return control to the agent after the human finishes. */
export async function resumeSessionControl(
  sessionId: string,
): Promise<BrowserSessionRecord> {
  const session = requireSession(sessionId);
  // Soft warn only — don't hard-block Resume on ephemeral YouTube/consent UI.
  const challenge = await detectBrowserChallenge(sessionPage(session)).catch(
    () => null,
  );
  const resumeStatus =
    session.statusBeforeControl &&
    session.statusBeforeControl !== "awaiting_user" &&
    session.statusBeforeControl !== "closed"
      ? session.statusBeforeControl
      : "ready";
  await syncAddressFromActive(session);
  touchSession(session, {
    userControl: false,
    challengeReason: challenge?.reason ?? null,
    statusBeforeControl: null,
    status: resumeStatus,
  });
  return session;
}

/**
 * Switch lesson role by activating the pinned tab when present.
 * Falls back to opening/navigating only if that role has no live tab yet.
 */
export async function switchSessionRole(
  sessionId: string,
  role: Exclude<BrowserLessonRole, "act">,
): Promise<BrowserSessionRecord> {
  const session = requireSession(sessionId);
  if (session.userControl) {
    throw new Error(
      "You’re in control of the browser. Finish the check, then click Resume.",
    );
  }
  const matrix = session.matrix;
  if (!matrix) {
    throw new Error("No lesson workspace is ready yet.");
  }
  const target = role === "ground" ? matrix.ground : matrix.truth;
  if (!target?.url) {
    throw new Error(
      role === "ground"
        ? "This lesson has no Ground step."
        : "This lesson has no Truth step.",
    );
  }

  // Prefer the already-open tab for this role (no reload — Muse-style switch).
  const pinned =
    (target.tabId ? findTab(session, target.tabId) : null) ||
    session.tabs.find((t) => t.role === role) ||
    null;

  if (pinned) {
    await activateSessionTab(session.id, pinned.id);
    const live = requireSession(sessionId);
    touchSession(live, {
      selectedSource: target.source,
      title: target.title,
      isYouTube: Boolean(target.isYouTube),
      matrix: { ...matrix, activeRole: role },
      status: "teaching",
    });
    const challenge = await detectBrowserChallenge(sessionPage(live)).catch(
      () => null,
    );
    if (challenge) {
      await takeSessionControl(live.id, challenge.reason);
      throw new Error(
        "You’re in control of the browser. Finish the check, then click Resume.",
      );
    }
    return requireSession(sessionId);
  }

  // No pinned tab yet — open one for this role.
  const tab = await openSessionTab(session, {
    kind: role,
    role,
    source: target.source,
    title: target.title,
    ...(target.isYouTube
      ? {
          load: async (page) => {
            const opened = await openYouTubeLesson(page, target.url);
            if (!opened.ok) {
              throw new Error("Could not reopen the Ground video.");
            }
            return { url: opened.url, title: target.title };
          },
        }
      : { url: target.url }),
  });

  if (session.matrix) {
    const nextMatrix = { ...session.matrix, activeRole: role };
    if (role === "ground" && nextMatrix.ground) {
      nextMatrix.ground = { ...nextMatrix.ground, tabId: tab.id };
    }
    if (role === "truth" && nextMatrix.truth) {
      nextMatrix.truth = { ...nextMatrix.truth, tabId: tab.id };
    }
    touchSession(session, {
      matrix: nextMatrix,
      selectedSource: target.source,
      title: target.title,
      isYouTube: Boolean(target.isYouTube),
      status: "teaching",
    });
  }

  const challenge = await detectBrowserChallenge(sessionPage(session)).catch(
    () => null,
  );
  if (challenge) {
    await takeSessionControl(session.id, challenge.reason);
    throw new Error(
      "You’re in control of the browser. Finish the check, then click Resume.",
    );
  }
  return requireSession(sessionId);
}

export async function destroySession(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;
  session.status = "closed";
  try {
    if (session.provider === "local") {
      await session.handle.page.context().close().catch(() => undefined);
    } else {
      // Close extra tabs first; closeHandle closes the active page + browser.
      for (const tab of session.tabs) {
        if (tab.page !== session.handle.page) {
          await tab.page.close().catch(() => undefined);
        }
      }
      await closeHandle(session.handle);
      if (session.remoteSessionId) {
        await closeBrowserbaseRemote(session.remoteSessionId);
      }
    }
  } finally {
    store().delete(sessionId);
  }
}

/** Drop sessions older than 2 hours (best-effort GC). */
export function gcStaleSessions(maxAgeMs = 2 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, session] of store()) {
    if (now - session.updatedAt > maxAgeMs) {
      void destroySession(id);
    }
  }
}
