import {
  detectBrowserChallenge,
  tryDismissMinorChallenge,
} from "@/lib/browser-experience/challenge";
import {
  extractPageText,
  type PageExtraction,
  waitForStablePage,
} from "@/lib/browser-experience/driver";
import {
  classifyBrowserIntent,
  shouldSeekGroundVideo,
} from "@/lib/browser-experience/intent";
import { openLiveBrowser } from "@/lib/browser-experience/openBrowser";
import {
  searchBrowserSources,
  searchDiagramImageSources,
} from "@/lib/browser-experience/search";
import {
  activateSessionTab,
  createSessionRecord,
  gcStaleSessions,
  openSessionTab,
  pinTabRole,
  pruneProbeTabs,
  requireSession,
  resetSessionTabs,
  sessionPage,
  switchSessionRole,
  takeSessionControl,
  toPublicSession,
  touchSession,
  type BrowserSessionRecord,
} from "@/lib/browser-experience/sessionStore";
import {
  beatsFromPlan,
  limitBeats,
  planActChecks,
  planBrowserLesson,
} from "@/lib/browser-experience/teach";
import type {
  BrowserLessonMatrix,
  BrowserLessonRole,
  BrowserStreamEvent,
  BrowserTeachBeat,
} from "@/lib/browser-experience/types";
import {
  verifyPageForQuestion,
  wantsDiagram,
  type PageVerdict,
  topicKeywords,
} from "@/lib/browser-experience/verify";
import {
  extractYouTubeMeta,
  openYouTubeLesson,
  searchYouTubeSources,
  wantsYouTube,
} from "@/lib/browser-experience/youtube";
import type { LessonSource } from "@/types/lesson";

const MAX_CANDIDATES_TO_CHECK = 4;

function clipSummary(value: string, max = 600): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function googleSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  return url.href;
}

async function emit(
  onEvent: ((event: BrowserStreamEvent) => void) | undefined,
  event: BrowserStreamEvent,
) {
  onEvent?.(event);
}

/**
 * If the live page is a CAPTCHA / bot wall, pause the agent until the human
 * finishes the check and clicks Resume (clears session.userControl).
 */
/** CAPTCHA + Google sign-in drills need a long human window (local Chromium). */
const CHALLENGE_WAIT_MS = 10 * 60 * 1000;

async function waitWhileUserHasControl(
  session: BrowserSessionRecord,
  onEvent?: (event: BrowserStreamEvent) => void,
  timeoutMs = CHALLENGE_WAIT_MS,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    let live: BrowserSessionRecord;
    try {
      live = requireSession(session.id);
    } catch {
      throw new Error("Session not found");
    }
    if (!live.userControl) {
      await emit(onEvent, {
        type: "status",
        status: "teaching",
        message: "Thanks — continuing the lesson…",
      });
      await emit(onEvent, {
        type: "session",
        session: toPublicSession(live),
      });
      return;
    }
  }
  throw new Error(
    "Timed out waiting for the browser check. Take control, finish it, then Resume.",
  );
}

async function handOffToUser(
  session: BrowserSessionRecord,
  reason: string,
  onEvent?: (event: BrowserStreamEvent) => void,
  timeoutMs = CHALLENGE_WAIT_MS,
): Promise<void> {
  await takeSessionControl(session.id, reason);
  const live = requireSession(session.id);
  await emit(onEvent, {
    type: "challenge",
    reason,
    session: toPublicSession(live),
  });
  await emit(onEvent, {
    type: "status",
    status: "awaiting_user",
    message: reason,
  });
  await emit(onEvent, { type: "session", session: toPublicSession(live) });
  await waitWhileUserHasControl(live, onEvent, timeoutMs);
}

async function waitForUserIfChallenge(
  session: BrowserSessionRecord,
  onEvent?: (event: BrowserStreamEvent) => void,
  timeoutMs = CHALLENGE_WAIT_MS,
): Promise<void> {
  const challenge = await detectBrowserChallenge(sessionPage(session)).catch(
    () => null,
  );
  if (!challenge && !session.userControl) return;

  // Minor walls: auto-dismiss / wait — do not force a long Take-control pause.
  if (challenge?.severity === "minor" && !session.userControl) {
    await emit(onEvent, {
      type: "status",
      status: "reading",
      message: challenge.reason,
    });
    await tryDismissMinorChallenge(sessionPage(session)).catch(() => false);
    return;
  }

  const reason =
    challenge?.reason ||
    session.challengeReason ||
    "Take control of the browser, finish the check, then click Resume.";
  await handOffToUser(session, reason, onEvent, timeoutMs);
}

/**
 * Source-page challenge handling:
 * - minor → dismiss / soft wait, then keep the source (don't skip)
 * - major → brief Take-control window, then soft-continue if readable
 * Returns false only when the page is still a hard wall with no usable content path.
 */
async function resolveSourceChallenge(
  session: BrowserSessionRecord,
  publisher: string,
  onEvent?: (event: BrowserStreamEvent) => void,
): Promise<"cleared" | "soft_continue" | "blocked"> {
  const page = sessionPage(session);
  let wall = await detectBrowserChallenge(page).catch(() => null);
  if (!wall) return "cleared";

  if (wall.severity === "minor") {
    await emit(onEvent, {
      type: "status",
      status: "reading",
      message: `${publisher}: ${wall.reason}`,
    });
    await tryDismissMinorChallenge(page).catch(() => false);
    wall = await detectBrowserChallenge(page).catch(() => null);
    if (!wall || wall.severity === "minor") {
      // Keep the source — minor banners shouldn't burn a good page.
      return "soft_continue";
    }
  }

  // Major: offer a short Take-control window (like Google search soft-skip),
  // then continue trying this source instead of throwing it away immediately.
  const reason =
    wall.reason ||
    `${publisher} needs a human check. Take control, or wait — we’ll try to keep this source.`;
  await takeSessionControl(session.id, reason).catch(() => undefined);
  await emit(onEvent, {
    type: "challenge",
    reason,
    session: toPublicSession(requireSession(session.id)),
  });
  await emit(onEvent, {
    type: "status",
    status: "awaiting_user",
    message: `${reason} (continuing in ~35s if you Resume or wait)`,
  });
  await emit(onEvent, {
    type: "session",
    session: toPublicSession(requireSession(session.id)),
  });
  try {
    await waitWhileUserHasControl(session, onEvent, 35_000);
  } catch {
    /* timeout — soft resume */
  }
  const live = requireSession(session.id);
  if (live.userControl) {
    touchSession(live, {
      userControl: false,
      challengeReason: null,
      statusBeforeControl: null,
      status: "reading",
    });
  }

  wall = await detectBrowserChallenge(sessionPage(live)).catch(() => null);
  if (!wall) return "cleared";
  if (wall.severity === "minor") {
    await tryDismissMinorChallenge(sessionPage(live)).catch(() => false);
    return "soft_continue";
  }
  // Still a major wall — caller may still try extract; only skip if unreadable.
  return "blocked";
}

async function showGoogleSearch(
  session: BrowserSessionRecord,
  query: string,
  onEvent?: (event: BrowserStreamEvent) => void,
) {
  await emit(onEvent, {
    type: "status",
    status: "opening_search",
    message: "Opening Google search…",
  });
  touchSession(session, {
    status: "opening_search",
    addressBar: googleSearchUrl(query),
  });
  await emit(onEvent, { type: "session", session: toPublicSession(session) });

  try {
    await openSessionTab(session, {
      kind: "search",
      title: query.slice(0, 60) || "Search",
      url: googleSearchUrl(query),
      reuseStarter: true,
    });
    await emit(onEvent, {
      type: "tabs",
      tabs: toPublicSession(session).tabs,
      activeTabId: session.activeTabId,
    });
    await emit(onEvent, { type: "session", session: toPublicSession(session) });
    await new Promise((resolve) => setTimeout(resolve, 700));
  } catch {
    /* Google often blocks automation — continue with Tavily sources. */
  }

  const page = sessionPage(session);
  // Soft handoff: offer Take control briefly, then ALWAYS continue to verified
  // sources so the lesson does not die on the search CAPTCHA.
  const wall = await detectBrowserChallenge(page).catch(() => null);
  if (wall || session.userControl) {
    const reason =
      wall?.reason ||
      "Google search needs a human check. Take control in the pane below, or wait — we’ll continue with verified sources.";
    await takeSessionControl(session.id, reason).catch(() => undefined);
    await emit(onEvent, {
      type: "challenge",
      reason,
      session: toPublicSession(requireSession(session.id)),
    });
    await emit(onEvent, {
      type: "status",
      status: "awaiting_user",
      message: `${reason} (continuing in ~45s if you Resume or wait)`,
    });
    await emit(onEvent, {
      type: "session",
      session: toPublicSession(requireSession(session.id)),
    });
    try {
      await waitWhileUserHasControl(session, onEvent, 45_000);
    } catch {
      /* timeout — soft resume */
    }
    const live = requireSession(session.id);
    if (live.userControl) {
      touchSession(live, {
        userControl: false,
        challengeReason: null,
        statusBeforeControl: null,
        status: "searching",
      });
    }
    await emit(onEvent, {
      type: "status",
      status: "searching",
      message: "Opening verified learning sources…",
    });
    await emit(onEvent, {
      type: "session",
      session: toPublicSession(requireSession(session.id)),
    });
  }
}

type CheckedPage = {
  source: LessonSource;
  extraction: PageExtraction;
  verdict: PageVerdict;
};

/**
 * Mandatory relatability tab: open one labeled diagram image alongside
 * article / video sources. Soft-fail if none found.
 */
async function openMandatoryDiagramTab(
  session: BrowserSessionRecord,
  prompt: string,
  onEvent?: (event: BrowserStreamEvent) => void,
): Promise<{ source: LessonSource; tabId: string } | null> {
  await emit(onEvent, {
    type: "status",
    status: "searching",
    message: "Finding a true labeled diagram (not a photo)…",
  });

  let images: LessonSource[] = [];
  try {
    images = await searchDiagramImageSources(prompt);
  } catch {
    images = [];
  }
  if (!images.length) {
    await emit(onEvent, {
      type: "status",
      status: "searching",
      message: "No labeled diagram found — continuing with other sources.",
    });
    return null;
  }

  const source = images[0]!;
  await emit(onEvent, {
    type: "status",
    status: "opening_source",
    message: `Opening diagram tab: ${source.title.slice(0, 70)}…`,
  });
  await emit(onEvent, { type: "source", source });

  try {
    const tab = await openSessionTab(session, {
      kind: "diagram",
      source,
      title: source.title,
      url: source.url,
    });
    // Keep diagram tab in the strip; don't steal focus forever — caller may
    // switch to Ground/Truth next. Still leave it open.
    touchSession(session, {
      sources: [
        source,
        ...session.sources.filter(
          (s) =>
            s.url.replace(/[?#].*$/, "").toLowerCase() !==
            source.url.replace(/[?#].*$/, "").toLowerCase(),
        ),
      ],
    });
    await emit(onEvent, {
      type: "tabs",
      tabs: toPublicSession(session).tabs,
      activeTabId: session.activeTabId,
    });
    await emit(onEvent, {
      type: "session",
      session: toPublicSession(session),
    });
    await emit(onEvent, {
      type: "status",
      status: "reading",
      message: "Diagram tab ready — keeping it open for relatability.",
    });
    return { source, tabId: tab.id };
  } catch {
    await emit(onEvent, {
      type: "status",
      status: "searching",
      message: "Could not open the diagram image — continuing.",
    });
    return null;
  }
}

/**
 * Open each candidate, extract content, and only keep a page that
 * cross-checks against the student's question (topic + diagram needs).
 */
async function findVerifiedPage(
  session: BrowserSessionRecord,
  prompt: string,
  sources: LessonSource[],
  onEvent?: (event: BrowserStreamEvent) => void,
): Promise<CheckedPage & { tabId: string }> {
  const candidates = sources.slice(0, MAX_CANDIDATES_TO_CHECK);
  let best: (CheckedPage & { tabId: string }) | null = null;
  const openedTabIds: string[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const source = candidates[i]!;
    await emit(onEvent, {
      type: "status",
      status: "opening_source",
      message: `Opening tab ${i + 1}/${candidates.length}: ${source.publisher}…`,
    });
    touchSession(session, {
      status: "opening_source",
      addressBar: source.url,
      selectedSource: source,
    });
    await emit(onEvent, { type: "session", session: toPublicSession(session) });
    await emit(onEvent, { type: "source", source });

    let tabId: string;
    try {
      const tab = await openSessionTab(session, {
        kind: "source",
        source,
        title: source.title,
        url: source.url,
      });
      tabId = tab.id;
      openedTabIds.push(tabId);
      await waitForStablePage(tab.page, { settleMs: 500, timeoutMs: 15_000 });
    } catch {
      await emit(onEvent, {
        type: "status",
        status: "reading",
        message: `Could not open ${source.publisher}. Trying next…`,
      });
      continue;
    }

    await emit(onEvent, {
      type: "tabs",
      tabs: toPublicSession(session).tabs,
      activeTabId: session.activeTabId,
    });
    await emit(onEvent, { type: "session", session: toPublicSession(session) });

    const page = sessionPage(session);
    const challengeState = await resolveSourceChallenge(
      session,
      source.publisher,
      onEvent,
    );
    if (challengeState === "blocked") {
      // Last chance: if we can still read real article text past the wall, keep it.
      let peek: PageExtraction | null = null;
      try {
        peek = await extractPageText(page);
      } catch {
        peek = null;
      }
      if (!peek || peek.text.length < 120) {
        await emit(onEvent, {
          type: "status",
          status: "reading",
          message: `${source.publisher} still blocked. Trying next…`,
        });
        continue;
      }
      await emit(onEvent, {
        type: "status",
        status: "reading",
        message: `${source.publisher}: kept despite a security check — content looks usable.`,
      });
    } else if (challengeState === "soft_continue") {
      await emit(onEvent, {
        type: "status",
        status: "reading",
        message: `${source.publisher}: soft check cleared — keeping this source.`,
      });
    }

    await emit(onEvent, {
      type: "status",
      status: "reading",
      message: `Cross-checking ${source.publisher} for the right content…`,
    });

    let extraction: PageExtraction;
    try {
      extraction = await extractPageText(sessionPage(session));
    } catch {
      await emit(onEvent, {
        type: "status",
        status: "reading",
        message: `Could not read ${source.publisher}. Trying next…`,
      });
      continue;
    }

    const verdict = verifyPageForQuestion(prompt, extraction, {
      excerpt: source.excerpt,
    });
    const checked: CheckedPage & { tabId: string } = {
      source,
      extraction,
      verdict,
      tabId,
    };

    if (!best || verdict.score > best.verdict.score) {
      best = checked;
    }

    if (verdict.ok) {
      pinTabRole(session, tabId, "truth", source);
      await pruneProbeTabs(
        session,
        new Set(
          [
            tabId,
            ...session.tabs
              .filter((t) => t.role === "ground" || t.kind === "search")
              .map((t) => t.id),
          ].filter(Boolean),
        ),
      );
      await activateSessionTab(session.id, tabId);
      await emit(onEvent, {
        type: "status",
        status: "reading",
        message: `Verified ${source.publisher} — this page has the content we need.`,
      });
      await emit(onEvent, {
        type: "tabs",
        tabs: toPublicSession(session).tabs,
        activeTabId: session.activeTabId,
      });
      await emit(onEvent, {
        type: "session",
        session: toPublicSession(session),
      });
      return checked;
    }

    await emit(onEvent, {
      type: "status",
      status: "reading",
      message: `Skipped ${source.publisher}: ${verdict.reasons[0] || "not a good match"}. Trying next…`,
    });
  }

  // No candidate fully passed — use the strongest usable page so basic asks
  // still get a Truth step after Google search walls.
  if (best && best.verdict.score >= 22 && best.extraction.text.length >= 80) {
    await emit(onEvent, {
      type: "status",
      status: "reading",
      message: `Using best available match (${best.source.publisher}).`,
    });
    pinTabRole(session, best.tabId, "truth", best.source);
    await pruneProbeTabs(
      session,
      new Set(
        [
          best.tabId,
          ...session.tabs
            .filter((t) => t.role === "ground" || t.kind === "search")
            .map((t) => t.id),
        ].filter(Boolean),
      ),
    );
    await activateSessionTab(session.id, best.tabId);
    try {
      best = {
        ...best,
        extraction: await extractPageText(sessionPage(session)),
      };
    } catch {
      /* keep previous extraction */
    }
    await emit(onEvent, {
      type: "tabs",
      tabs: toPublicSession(session).tabs,
      activeTabId: session.activeTabId,
    });
    await emit(onEvent, { type: "session", session: toPublicSession(session) });
    return best;
  }

  void openedTabIds;
  const hint = wantsDiagram(prompt)
    ? "I couldn’t find a page with a clear labeled diagram for that. Try naming the topic more specifically."
    : "I couldn’t find a page that clearly covers that topic. Try a more specific question.";
  throw new Error(hint);
}

/** Domains that often match weakly via metaphor (anatomy→travel) — penalize. */
const YT_OFFTOPIC =
  /\b(anatomy|human body|skeleton|musculoskeletal|digestive|circulatory|neuron|cell biology|organ system|physiology textbook)\b/i;

const YT_TRAVEL_ASK =
  /\b(travel|travelling|traveling|trip|tourism|backpack|flight|airline|passport|visa|world tour|around the world|hike|hiking|voyage)\b/i;

function scoreYouTubeCandidate(
  prompt: string,
  source: LessonSource,
  title: string,
): number {
  const hay = `${title} ${source.title} ${source.excerpt}`.toLowerCase();
  const keys = topicKeywords(prompt).filter(
    (k) => !/^(youtube|video|watch|clip|how|does|work)$/i.test(k),
  );
  if (!keys.length) return 20;

  let hits = 0;
  let weighted = 0;
  for (const key of keys) {
    if (hay.includes(key)) {
      hits += 1;
      weighted += key.length >= 5 ? 1.35 : 1;
    }
  }
  let score = Math.round((weighted / Math.max(keys.length, 1)) * 100);

  // Title must share at least one real topic token for a strong accept.
  const titleHay = `${title} ${source.title}`.toLowerCase();
  const titleHits = keys.filter((k) => titleHay.includes(k)).length;
  if (titleHits === 0) score -= 35;
  else score += Math.min(20, titleHits * 8);

  // Soft educational boost only when already on-topic.
  if (hits >= 2 && /\b(explained|how to|guide|crash course|travel)\b/i.test(hay)) {
    score += 8;
  }

  // Travel / lifestyle asks should not land on pure anatomy primers.
  if (YT_TRAVEL_ASK.test(prompt) && YT_OFFTOPIC.test(hay) && !YT_TRAVEL_ASK.test(hay)) {
    score -= 55;
  } else if (YT_OFFTOPIC.test(hay) && !YT_OFFTOPIC.test(prompt) && hits <= 1) {
    score -= 30;
  }

  return Math.max(0, Math.min(100, score));
}

const YT_ACCEPT_SCORE = 48;
const YT_OPEN_MIN_SCORE = 28;

async function findVerifiedYouTube(
  session: BrowserSessionRecord,
  prompt: string,
  sources: LessonSource[],
  onEvent?: (event: BrowserStreamEvent) => void,
): Promise<{
  source: LessonSource;
  title: string;
  url: string;
  pageText: string;
  durationSec: number | null;
  tabId: string;
}> {
  // Pre-rank by title/excerpt so we don't open an anatomy video for “travel”.
  const ranked = [...sources]
    .map((source) => ({
      source,
      preScore: scoreYouTubeCandidate(prompt, source, source.title),
    }))
    .sort((a, b) => b.preScore - a.preScore)
    .filter((row) => row.preScore >= YT_OPEN_MIN_SCORE)
    .slice(0, MAX_CANDIDATES_TO_CHECK);

  if (!ranked.length) {
    throw new Error(
      "No on-topic YouTube videos found for that question. Continuing without Ground video…",
    );
  }

  let best: {
    source: LessonSource;
    title: string;
    url: string;
    pageText: string;
    durationSec: number | null;
    score: number;
    tabId: string;
  } | null = null;

  for (let i = 0; i < ranked.length; i += 1) {
    const source = ranked[i]!.source;
    await emit(onEvent, {
      type: "status",
      status: "opening_source",
      message: `Opening video tab ${i + 1}/${ranked.length}: ${source.title.slice(0, 60)}…`,
    });
    touchSession(session, {
      status: "opening_source",
      addressBar: source.url,
      selectedSource: source,
      isYouTube: true,
    });
    await emit(onEvent, { type: "session", session: toPublicSession(session) });
    await emit(onEvent, { type: "source", source });

    let tabId: string;
    let opened: Awaited<ReturnType<typeof openYouTubeLesson>>;
    try {
      const loadHolder: {
        result: Awaited<ReturnType<typeof openYouTubeLesson>> | null;
      } = { result: null };
      const tab = await openSessionTab(session, {
        kind: "source",
        source,
        title: source.title,
        load: async (page) => {
          loadHolder.result = await openYouTubeLesson(page, source.url);
          return {
            url: loadHolder.result.url,
            title: source.title,
          };
        },
      });
      tabId = tab.id;
      opened = loadHolder.result ?? {
        ok: false,
        mode: "watch",
        url: tab.url,
        reason: "open_failed",
      };
    } catch {
      await emit(onEvent, {
        type: "status",
        status: "reading",
        message: "That video wouldn’t play in the lesson browser. Trying next…",
      });
      continue;
    }

    await emit(onEvent, {
      type: "tabs",
      tabs: toPublicSession(session).tabs,
      activeTabId: session.activeTabId,
    });

    const page = sessionPage(session);

    // Error 153 / bot sign-in / Google — force Take control, then retry once.
    if (!opened.ok && opened.needsHuman) {
      touchSession(session, {
        currentUrl: opened.url,
        addressBar: opened.url,
      });
      try {
        await handOffToUser(
          session,
          opened.reason === "Error 153" ||
            /153|configuration/i.test(opened.reason || "")
            ? "YouTube Error 153 — Take control, use Watch on YouTube / sign-in if needed, then Resume."
            : "YouTube needs a human check (sign-in / bot). Take control, finish it, then Resume.",
          onEvent,
        );
      } catch {
        await emit(onEvent, {
          type: "status",
          status: "reading",
          message: "Still blocked on that video. Trying next…",
        });
        continue;
      }
      opened = await openYouTubeLesson(page, source.url);
    } else if (opened.ok) {
      try {
        await waitForUserIfChallenge(session, onEvent);
      } catch {
        /* try next candidate */
      }
    }

    if (!opened.ok) {
      await emit(onEvent, {
        type: "status",
        status: "reading",
        message: "That video wouldn’t play in the lesson browser. Trying next…",
      });
      continue;
    }

    touchSession(session, {
      currentUrl: opened.url,
      addressBar: opened.url,
      status: "reading",
    });
    await emit(onEvent, { type: "session", session: toPublicSession(session) });

    const meta = await extractYouTubeMeta(page).catch(() => ({
      title: source.title,
      url: opened.url,
      durationSec: null as number | null,
    }));
    const pageText = [meta.title, source.excerpt, source.title]
      .filter(Boolean)
      .join("\n");
    const score = scoreYouTubeCandidate(
      prompt,
      source,
      meta.title || source.title,
    );
    const candidate = {
      source: { ...source, url: opened.url },
      title: meta.title || source.title,
      url: opened.url,
      pageText,
      durationSec: meta.durationSec,
      score,
      tabId,
    };

    if (!best || candidate.score > best.score) best = candidate;

    if (score >= YT_ACCEPT_SCORE) {
      pinTabRole(session, tabId, "ground", candidate.source);
      await pruneProbeTabs(
        session,
        new Set(
          [
            tabId,
            ...session.tabs
              .filter((t) => t.kind === "search" || t.role === "truth")
              .map((t) => t.id),
          ].filter(Boolean),
        ),
      );
      await activateSessionTab(session.id, tabId);
      await emit(onEvent, {
        type: "status",
        status: "reading",
        message:
          opened.mode === "embed"
            ? `Playing via YouTube player: ${candidate.title.slice(0, 60)}`
            : `Found a matching video: ${candidate.title.slice(0, 70)}`,
      });
      await emit(onEvent, {
        type: "tabs",
        tabs: toPublicSession(session).tabs,
        activeTabId: session.activeTabId,
      });
      return candidate;
    }

    await emit(onEvent, {
      type: "status",
      status: "reading",
      message: "Video title didn’t match well. Trying next…",
    });
  }

  if (best && best.score >= YT_OPEN_MIN_SCORE + 10) {
    pinTabRole(session, best.tabId, "ground", best.source);
    await pruneProbeTabs(
      session,
      new Set(
        [
          best.tabId,
          ...session.tabs
            .filter((t) => t.kind === "search" || t.role === "truth")
            .map((t) => t.id),
        ].filter(Boolean),
      ),
    );
    await activateSessionTab(session.id, best.tabId);
    if (sessionPage(session).url() !== best.url) {
      const reopened = await openYouTubeLesson(
        sessionPage(session),
        best.source.url,
      );
      if (reopened.ok) {
        best = {
          ...best,
          url: reopened.url,
          source: { ...best.source, url: reopened.url },
        };
      }
    }
    await emit(onEvent, {
      type: "tabs",
      tabs: toPublicSession(session).tabs,
      activeTabId: session.activeTabId,
    });
    return best;
  }

  throw new Error(
    "No YouTube video was close enough to the question. Continuing with a webpage instead.",
  );
}

export async function runBrowserAsk(input: {
  prompt: string;
  sessionId?: string;
  onEvent?: (event: BrowserStreamEvent) => void;
}): Promise<{
  session: BrowserSessionRecord;
  beats: BrowserTeachBeat[];
  summary: string;
}> {
  gcStaleSessions();
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Prompt is required");

  let session: BrowserSessionRecord | null = null;
  if (input.sessionId) {
    try {
      session = requireSession(input.sessionId);
    } catch {
      session = null;
    }
  }

  try {
    const youtubeMode = wantsYouTube(prompt);

    await emit(input.onEvent, {
      type: "status",
      status: "searching",
      message: youtubeMode
        ? "Finding a YouTube video for that topic…"
        : "Finding candidate learning pages…",
    });

    const sources = youtubeMode
      ? await searchYouTubeSources(prompt)
      : await searchBrowserSources(prompt);
    if (!sources.length) {
      throw new Error(
        youtubeMode
          ? "No YouTube videos found for that question. Try a more specific topic."
          : "No credible sources found for that question. Try a more specific topic.",
      );
    }

    if (!session) {
      await emit(input.onEvent, {
        type: "status",
        status: "starting",
        message: "Starting browser…",
      });
      const handle = await openLiveBrowser();
      session = createSessionRecord(handle, prompt);
    } else {
      await resetSessionTabs(session);
      touchSession(session, {
        question: prompt,
        title: null,
        pageText: "",
        beats: [],
        selectedSource: null,
        sources,
        isYouTube: youtubeMode,
        matrix: null,
        userControl: false,
        challengeReason: null,
        statusBeforeControl: null,
        history: [{ role: "user", content: prompt }],
      });
    }

    touchSession(session, {
      sources,
      status: "searching",
      isYouTube: youtubeMode,
      matrix: null,
      userControl: false,
      challengeReason: null,
      statusBeforeControl: null,
    });
    await emit(input.onEvent, {
      type: "session",
      session: toPublicSession(session),
    });

    const intent = classifyBrowserIntent(prompt);
    const searchQuery = youtubeMode
      ? `${prompt.replace(/\b(youtube|yt|video|watch)\b/gi, " ").trim()} site:youtube.com`
      : prompt;
    await showGoogleSearch(session, searchQuery, input.onEvent);

    // Always open one labeled diagram image tab for relatability (soft-fail).
    const diagramTab = await openMandatoryDiagramTab(
      session,
      prompt,
      input.onEvent,
    );

    // Explicit YouTube ask → Ground video + Act (no separate Truth page).
    if (youtubeMode) {
      const video = await findVerifiedYouTube(
        session,
        prompt,
        sources,
        input.onEvent,
      );

      touchSession(session, {
        selectedSource: video.source,
        title: video.title,
        pageText: video.pageText,
        currentUrl: video.url,
        addressBar: video.url,
        status: "teaching",
        isYouTube: true,
      });
      await emit(input.onEvent, {
        type: "session",
        session: toPublicSession(session),
      });
      await emit(input.onEvent, { type: "source", source: video.source });

      await emit(input.onEvent, {
        type: "status",
        status: "teaching",
        message: "Ground ready. Planning video walkthrough + Act checks…",
      });

      const plan = await planBrowserLesson({
        question: prompt,
        source: video.source,
        pageTitle: video.title,
        pageUrl: video.url,
        pageText: video.pageText,
        isYouTube: true,
        durationSec: video.durationSec,
        history: session.history,
        followUp: false,
      });
      const beats = beatsFromPlan(plan, "ground", video.tabId);
      const actQuestions = await planActChecks({
        question: prompt,
        pageTitle: video.title,
        pageText: video.pageText,
        source: video.source,
      });
      const roles: BrowserLessonRole[] = ["ground", "act"];
      const matrix: BrowserLessonMatrix = {
        intent,
        roles,
        ground: {
          role: "ground",
          url: video.url,
          title: video.title,
          source: video.source,
          isYouTube: true,
          tabId: video.tabId,
        },
        truth: null,
        act: { questions: actQuestions },
        activeRole: "ground",
      };

      touchSession(session, {
        beats,
        title: plan.title,
        status: "ready",
        isYouTube: true,
        matrix,
        history: [
          ...session.history,
          { role: "assistant", content: plan.summary },
        ],
      });

      await emit(input.onEvent, {
        type: "session",
        session: toPublicSession(session),
      });
      await emit(input.onEvent, { type: "matrix", matrix });
      await emit(input.onEvent, {
        type: "beats",
        beats,
        summary: plan.summary,
      });
      await emit(input.onEvent, { type: "done" });

      return { session, beats, summary: plan.summary };
    }

    // Webpage path: optional Ground (YouTube) → Truth page → Act checks.
    let groundBeats: BrowserTeachBeat[] = [];
    let groundMeta: BrowserLessonMatrix["ground"] = null;

    if (shouldSeekGroundVideo(intent, false)) {
      await emit(input.onEvent, {
        type: "status",
        status: "searching",
        message: "Looking for a short Ground video…",
      });
      try {
        const ytSources = await searchYouTubeSources(prompt);
        if (ytSources.length) {
          const video = await findVerifiedYouTube(
            session,
            prompt,
            ytSources,
            input.onEvent,
          );
          await emit(input.onEvent, {
            type: "status",
            status: "teaching",
            message: "Planning a short Ground intro on the video…",
          });
          const groundPlan = await planBrowserLesson({
            question: prompt,
            source: video.source,
            pageTitle: video.title,
            pageUrl: video.url,
            pageText: video.pageText,
            isYouTube: true,
            durationSec: video.durationSec,
            history: session.history,
            followUp: false,
          });
          groundBeats = limitBeats(
            beatsFromPlan(groundPlan, "ground", video.tabId),
            4,
          );
          groundMeta = {
            role: "ground",
            url: video.url,
            title: video.title,
            source: video.source,
            isYouTube: true,
            tabId: video.tabId,
          };
        }
      } catch {
        groundBeats = [];
        groundMeta = null;
        await emit(input.onEvent, {
          type: "status",
          status: "searching",
          message: "No Ground video — continuing with the Truth page…",
        });
      }
    }

    const verified = await findVerifiedPage(
      session,
      prompt,
      sources,
      input.onEvent,
    );

    const truthTitle = verified.extraction.title || verified.source.title;
    touchSession(session, {
      selectedSource: verified.source,
      title: truthTitle,
      pageText: verified.extraction.text,
      currentUrl: verified.extraction.url,
      addressBar: verified.extraction.url,
      status: "teaching",
      isYouTube: false,
    });
    await emit(input.onEvent, {
      type: "session",
      session: toPublicSession(session),
    });
    await emit(input.onEvent, { type: "source", source: verified.source });

    await emit(input.onEvent, {
      type: "status",
      status: "teaching",
      message: groundMeta
        ? "Truth page verified. Planning Truth walkthrough + Act…"
        : "Page verified. Preparing Truth walkthrough + Act…",
    });

    const truthPlan = await planBrowserLesson({
      question: prompt,
      source: verified.source,
      pageTitle: truthTitle,
      pageUrl: verified.extraction.url,
      pageText: verified.extraction.text,
      anchors: verified.extraction.anchors,
      hasLargeFigure: verified.extraction.hasLargeFigure,
      isYouTube: false,
      history: session.history,
      followUp: false,
    });
    const truthBeats = beatsFromPlan(truthPlan, "truth", verified.tabId);
    const actQuestions = await planActChecks({
      question: prompt,
      pageTitle: truthTitle,
      pageText: verified.extraction.text,
      source: verified.source,
    });

    const roles: BrowserLessonRole[] = [
      ...(groundMeta ? (["ground"] as const) : []),
      "truth",
      "act",
    ];
    const matrix: BrowserLessonMatrix = {
      intent,
      roles,
      ground: groundMeta,
      truth: {
        role: "truth",
        url: verified.extraction.url,
        title: truthTitle,
        source: verified.source,
        isYouTube: false,
        tabId: verified.tabId,
      },
      act: { questions: actQuestions },
      activeRole: groundMeta ? "ground" : "truth",
    };

    const summary = groundMeta
      ? clipSummary(`${groundMeta.title} → ${truthPlan.summary}`)
      : truthPlan.summary;

    let finalGroundBeats = groundBeats;
    let liveMatrix = matrix;

    // Start the live view on Ground when present so the client can play in order.
    if (groundMeta) {
      touchSession(session, { matrix });
      try {
        await switchSessionRole(session.id, "ground");
        liveMatrix = session.matrix ?? matrix;
      } catch {
        finalGroundBeats = [];
        liveMatrix = {
          ...matrix,
          ground: null,
          activeRole: "truth",
          roles: roles.filter((r) => r !== "ground"),
        };
        touchSession(session, { matrix: liveMatrix });
      }
    }

    const finalBeats = [...finalGroundBeats, ...truthBeats];
    const citedSources = [
      liveMatrix.ground?.source,
      liveMatrix.truth?.source,
      ...session.sources,
    ].filter((s): s is LessonSource => Boolean(s?.url));
    const uniqueSources: LessonSource[] = [];
    const seenUrl = new Set<string>();
    for (const source of citedSources) {
      const key = source.url.replace(/[?#].*$/, "").toLowerCase();
      if (seenUrl.has(key)) continue;
      seenUrl.add(key);
      uniqueSources.push(source);
    }
    touchSession(session, {
      beats: finalBeats,
      title: truthPlan.title,
      status: "ready",
      matrix: liveMatrix,
      sources: uniqueSources,
      history: [
        ...session.history,
        { role: "assistant", content: summary },
      ],
    });

    await emit(input.onEvent, {
      type: "session",
      session: toPublicSession(session),
    });
    await emit(input.onEvent, { type: "matrix", matrix: liveMatrix });
    await emit(input.onEvent, {
      type: "beats",
      beats: finalBeats,
      summary,
    });
    await emit(input.onEvent, { type: "done" });

    return { session, beats: finalBeats, summary };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong while starting the browser lesson.";
    if (session) {
      touchSession(session, { status: "error" });
      await emit(input.onEvent, {
        type: "session",
        session: toPublicSession(session),
      });
    }
    await emit(input.onEvent, { type: "error", error: message });
    // Keep the browser session alive so Take control / retry still works.
    throw error instanceof Error ? error : new Error(message);
  }
}

export async function runBrowserFollowUp(input: {
  sessionId: string;
  prompt: string;
  onEvent?: (event: BrowserStreamEvent) => void;
}): Promise<{
  session: BrowserSessionRecord;
  beats: BrowserTeachBeat[];
  summary: string;
}> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Prompt is required");
  const session = requireSession(input.sessionId);
  const source = session.selectedSource;
  if (!source || !session.pageText) {
    throw new Error("Start a browser lesson first.");
  }

  try {
    touchSession(session, {
      question: prompt,
      status: "teaching",
      history: [...session.history, { role: "user", content: prompt }],
    });
    await emit(input.onEvent, {
      type: "status",
      status: "teaching",
      message: session.isYouTube
        ? "Jumping to the relevant part of this video…"
        : "Answering from this verified page…",
    });
    await emit(input.onEvent, {
      type: "session",
      session: toPublicSession(session),
    });

    let durationSec: number | null = null;
    let anchors: string[] = [];
    let hasLargeFigure = false;

    if (session.isYouTube) {
      const meta = await extractYouTubeMeta(sessionPage(session)).catch(() => null);
      if (meta) {
        durationSec = meta.durationSec;
        touchSession(session, {
          title: meta.title || session.title,
          currentUrl: meta.url,
          addressBar: meta.url,
        });
      }
    } else {
      const extracted = await extractPageText(sessionPage(session)).catch(() => ({
        title: session.title || source.title,
        url: session.currentUrl,
        text: session.pageText,
        anchors: [] as string[],
        hasLargeFigure: false,
      }));
      anchors = extracted.anchors;
      hasLargeFigure = extracted.hasLargeFigure;
      if (extracted.text.length > 80) {
        touchSession(session, {
          pageText: extracted.text,
          title: extracted.title || session.title,
          currentUrl: extracted.url,
          addressBar: extracted.url,
        });
      }
    }

    const plan = await planBrowserLesson({
      question: prompt,
      source,
      pageTitle: session.title || source.title,
      pageUrl: session.currentUrl,
      pageText: session.pageText,
      anchors,
      hasLargeFigure,
      isYouTube: session.isYouTube,
      durationSec,
      history: session.history,
      followUp: true,
    });
    const beats = beatsFromPlan(plan);

    touchSession(session, {
      beats,
      title: plan.title,
      status: "ready",
      history: [
        ...session.history,
        { role: "assistant", content: plan.summary },
      ],
    });

    await emit(input.onEvent, {
      type: "session",
      session: toPublicSession(session),
    });
    await emit(input.onEvent, {
      type: "beats",
      beats,
      summary: plan.summary,
    });
    await emit(input.onEvent, { type: "done" });

    return { session, beats, summary: plan.summary };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not answer that follow-up.";
    touchSession(session, { status: "error" });
    await emit(input.onEvent, { type: "error", error: message });
    throw error instanceof Error ? error : new Error(message);
  }
}
