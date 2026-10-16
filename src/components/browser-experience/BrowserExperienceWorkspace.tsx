"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { BrowserChrome } from "@/components/browser-experience/BrowserChrome";
import {
  BoardNarration,
  type BoardNarrationLine,
} from "@/components/board/BoardNarration";
import { AccountMenu } from "@/components/lms/AccountMenu";
import { AppHeader } from "@/components/lms/AppHeader";
import { AppShell } from "@/components/lms/AppShell";
import { PromptBar } from "@/components/PromptBar";
import { Button } from "@/components/ui/button";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import {
  activateBrowserTab,
  annotateBrowserSession,
  closeBrowserSession,
  closeBrowserTab,
  fetchBrowserFrame,
  fetchBrowserSession,
  navigateBrowserOmnibox,
  openBrowserTab,
  reloadBrowserTab,
  requestBrowserAsk,
  requestBrowserFollowUp,
  resumeBrowserControl,
  sendBrowserInput,
  speakBrowserLine,
  switchBrowserRole,
  takeBrowserControl,
} from "@/lib/browser-experience/client";
import type { BrowserPaneInput } from "@/components/browser-experience/BrowserChrome";
import { isFollowUpPrompt } from "@/lib/browser-experience/followUp";
import type {
  BrowserActQuestion,
  BrowserLessonMatrix,
  BrowserLessonRole,
  BrowserSessionPublic,
  BrowserStreamEvent,
  BrowserTeachBeat,
} from "@/lib/browser-experience/types";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { cn } from "@/lib/utils";
import type { LessonSource } from "@/types/lesson";

function mergeLessonSources(
  ...lists: Array<LessonSource | null | undefined | LessonSource[]>
): LessonSource[] {
  const out: LessonSource[] = [];
  const seen = new Set<string>();
  for (const item of lists) {
    const rows = Array.isArray(item) ? item : item ? [item] : [];
    for (const source of rows) {
      if (!source?.url) continue;
      const key = source.url.replace(/[?#].*$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(source);
    }
  }
  return out;
}

type Phase =
  | "idle"
  | "working"
  | "teaching"
  | "awaiting_user"
  | "act"
  | "ready"
  | "error";

function statusMessage(
  status: BrowserSessionPublic["status"] | null,
  fallback: string,
): string {
  switch (status) {
    case "starting":
      return "Starting a private browser…";
    case "searching":
      return "Searching for a clear learning page…";
    case "opening_search":
      return "Opening Google search…";
    case "opening_source":
      return "Opening the best learning page…";
    case "reading":
      return "Reading the page…";
    case "teaching":
      return "Walking you through it…";
    case "awaiting_user":
      return "You’re in control — finish the check in the browser, then Resume.";
    case "ready":
      return "Ask a follow-up about this page, or a new topic to search again.";
    case "error":
      return "Something went wrong in the browser session.";
    default:
      return fallback;
  }
}

type ControlBannerMode = "agent" | "user_active" | "user_idle";

function ControlBanner({
  reason,
  controlBusy,
  onTake,
  onResume,
  userControl,
  provider,
}: {
  reason: string | null;
  controlBusy: boolean;
  userControl: boolean;
  provider: BrowserSessionPublic["provider"] | null;
  onTake: () => void;
  onResume: () => void;
}) {
  const [mode, setMode] = useState<ControlBannerMode>(
    userControl ? "user_active" : "agent",
  );

  useEffect(() => {
    if (!userControl) {
      setMode("agent");
      return;
    }
    setMode("user_active");
    let idleTimer: number | null = null;
    const bump = () => {
      setMode("user_active");
      if (idleTimer != null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setMode("user_idle"), 5_000);
    };
    bump();
    window.addEventListener("pointermove", bump, { passive: true });
    window.addEventListener("keydown", bump);
    window.addEventListener("pointerdown", bump, { passive: true });
    return () => {
      if (idleTimer != null) window.clearTimeout(idleTimer);
      window.removeEventListener("pointermove", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("pointerdown", bump);
    };
  }, [userControl]);

  const localHint =
    provider === "local"
      ? " Click and type in the pane, then Resume."
      : " Use the pane below, then Resume.";

  let copy: string;
  if (mode === "user_idle") {
    copy =
      "Idle a bit — continue the lesson, or keep control?";
  } else if (mode === "user_active") {
    copy =
      (reason ||
        "You’re in control — finish CAPTCHA or Google sign-in, then Resume.") +
      localHint;
  } else {
    copy =
      "CAPTCHA or Google sign-in? Take control, then Resume so the lesson can continue.";
  }

  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-3 rounded-xl border px-3 py-2",
        mode === "user_idle"
          ? "border-sky-300 bg-sky-50"
          : userControl
            ? "border-amber-300 bg-amber-50"
            : "border-[#d5e0e9] bg-[#f7fafc]",
      )}
    >
      <p className="min-w-0 flex-1 text-xs leading-snug text-[#3d566c]">
        {copy}
      </p>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {userControl ? (
          <Button
            type="button"
            size="sm"
            disabled={controlBusy}
            onClick={onResume}
          >
            {mode === "user_idle"
              ? "Yes — continue lesson"
              : "Resume lesson"}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={controlBusy}
            onClick={onTake}
          >
            Take control
          </Button>
        )}
        {userControl && mode === "user_idle" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={controlBusy}
            onClick={() => setMode("user_active")}
          >
            Keep control
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function playAudio(
  mimeType: string,
  base64: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${mimeType};base64,${base64}`);
    const onAbort = () => {
      audio.pause();
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    audio.onended = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    audio.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    void audio.play().catch(() => resolve());
  });
}

function ActPanel({
  questions,
  onDone,
}: {
  questions: BrowserActQuestion[];
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const current = questions[index];

  if (!current) {
    return (
      <div className="rounded-xl border border-[#c9d7e3] bg-white p-4">
        <p className="text-sm text-[#3d566c]">Act complete.</p>
        <Button type="button" size="sm" className="mt-3" onClick={onDone}>
          Continue
        </Button>
      </div>
    );
  }

  const revealed = picked !== null;
  const correct = picked === current.answerIndex;

  return (
    <div className="rounded-xl border border-[#c9d7e3] bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a90a3]">
        Act · check {index + 1} of {questions.length}
      </p>
      <p className="mt-2 text-sm font-medium leading-relaxed text-[#0f1720]">
        {current.prompt}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {current.choices.map((choice, choiceIndex) => {
          const selected = picked === choiceIndex;
          const isAnswer = choiceIndex === current.answerIndex;
          return (
            <button
              key={`${current.id}-${choiceIndex}`}
              type="button"
              disabled={revealed}
              onClick={() => {
                setPicked(choiceIndex);
                if (choiceIndex === current.answerIndex) {
                  setScore((s) => s + 1);
                }
              }}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-sm transition",
                !revealed && "border-[#d5e0e9] hover:border-[#7aa2bf]",
                revealed && isAnswer && "border-emerald-500 bg-emerald-50",
                revealed && selected && !isAnswer && "border-rose-400 bg-rose-50",
                revealed && !selected && !isAnswer && "border-[#e8eef3] opacity-60",
              )}
            >
              {choice}
            </button>
          );
        })}
      </div>
      {revealed ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-[#5b7388]">
            {correct
              ? "Nice — that matches the page."
              : "Not quite — look at the highlighted answer."}
            {index === questions.length - 1
              ? ` Score ${score}/${questions.length}.`
              : null}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (index >= questions.length - 1) {
                onDone();
                return;
              }
              setIndex((i) => i + 1);
              setPicked(null);
            }}
          >
            {index >= questions.length - 1 ? "Finish Act" : "Next"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function BrowserExperienceWorkspace() {
  const { logout } = useAuth();
  const { beginQuestion, cancelQuestion, openAuth } = useQuestionAccess();

  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusLine, setStatusLine] = useState(
    "Ask a question. We’ll open sources in tabs — Ground → Truth — then Act checks.",
  );
  const [session, setSession] = useState<BrowserSessionPublic | null>(null);
  const [matrix, setMatrix] = useState<BrowserLessonMatrix | null>(null);
  const [activeRole, setActiveRole] = useState<BrowserLessonRole | null>(null);
  const [activeBeatId, setActiveBeatId] = useState<string | null>(null);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<BoardNarrationLine[]>([]);
  const [citedSources, setCitedSources] = useState<LessonSource[]>([]);
  /** Once Act starts, keep the panel mounted across Take control / Resume. */
  const [actActive, setActActive] = useState(false);
  const actActiveRef = useRef(false);
  const framePauseUntilRef = useRef(0);

  const abortRef = useRef<AbortController | null>(null);
  const teachAbortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const priorQuestionRef = useRef<string>("");
  const submittingRef = useRef(false);
  const noteSeqRef = useRef(0);
  const phaseBeforeControlRef = useRef<Phase | null>(null);
  const [controlBusy, setControlBusy] = useState(false);

  function setActActiveTracked(next: boolean) {
    actActiveRef.current = next;
    setActActive(next);
  }

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session?.id]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      teachAbortRef.current?.abort();
      const id = sessionIdRef.current;
      if (id) void closeBrowserSession(id);
    };
  }, []);

  async function refreshFrame(sessionId: string) {
    try {
      const image = await fetchBrowserFrame(sessionId);
      if (image) setFrameDataUrl(image);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!session?.frameStream || !session.id) return;
    let cancelled = false;
    const inControl =
      Boolean(session.userControl) || phase === "awaiting_user";
    // Slower frames while solving CAPTCHA — fast JPEG refresh makes puzzle tiles “fade”.
    const intervalMs = inControl ? 1600 : 650;
    const tick = async () => {
      if (Date.now() < framePauseUntilRef.current) return;
      try {
        const image = await fetchBrowserFrame(session.id);
        if (!cancelled && image) setFrameDataUrl(image);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    session?.frameStream,
    session?.id,
    session?.userControl,
    phase,
    activeBeatId,
    activeRole,
  ]);

  function pushNote(text: string, kind: BoardNarrationLine["kind"] = "narration") {
    const cleaned = text.trim();
    if (!cleaned) return;
    noteSeqRef.current += 1;
    const id = `n-${noteSeqRef.current}`;
    setNotes((prev) => [...prev, { id, text: cleaned, kind }]);
  }

  function onStreamEvent(event: BrowserStreamEvent) {
    if (event.type === "status") {
      setStatusLine(event.message || statusMessage(event.status, statusLine));
      if (event.status === "awaiting_user" && !actActiveRef.current) {
        setPhase("awaiting_user");
      }
    }
    if (event.type === "session") {
      setSession(event.session);
      if (event.session.matrix) {
        setMatrix(event.session.matrix);
        setActiveRole(event.session.matrix.activeRole);
      }
      if (event.session.userControl) {
        if (!actActiveRef.current) {
          setPhase("awaiting_user");
        }
        setStatusLine(
          event.session.challengeReason ||
            statusMessage("awaiting_user", statusLine),
        );
      }
      setStatusLine(
        event.session.userControl
          ? event.session.challengeReason ||
              statusMessage("awaiting_user", statusLine)
          : statusMessage(event.session.status, statusLine),
      );
    }
    if (event.type === "challenge") {
      setSession(event.session);
      if (!actActiveRef.current) {
        setPhase("awaiting_user");
      }
      setStatusLine(event.reason);
      pushNote(event.reason, "summary");
      // Stay in-app — never bounce to Browserless in a new tab.
    }
    if (event.type === "matrix") {
      setMatrix(event.matrix);
      setActiveRole(event.matrix.activeRole);
      setCitedSources((prev) =>
        mergeLessonSources(
          prev,
          event.matrix.ground?.source,
          event.matrix.truth?.source,
        ),
      );
    }
    if (event.type === "source") {
      setCitedSources((prev) => mergeLessonSources(prev, event.source));
      setStatusLine(`Opened ${event.source.publisher}: ${event.source.title}`);
    }
    if (event.type === "tabs") {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              tabs: event.tabs,
              activeTabId: event.activeTabId,
            }
          : prev,
      );
    }
    if (event.type === "error") {
      setPhase("error");
      pushNote(event.error, "error");
    }
  }

  async function waitWhileUserHasControl(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<BrowserSessionPublic | null> {
    let latest: BrowserSessionPublic | null = null;
    while (!signal.aborted) {
      latest = await fetchBrowserSession(sessionId, signal);
      if (latest) {
        setSession(latest);
        if (latest.liveViewUrl) {
          /* keep iframe src fresh when Browserless remints */
        }
        if (!latest.userControl) {
          return latest;
        }
        // Don't yank the UI out of Act while the user is in control — Act stays
        // mounted via actActive; only sync the control banner phase otherwise.
        if (!actActiveRef.current) {
          setPhase("awaiting_user");
        }
        setStatusLine(
          latest.challengeReason ||
            "You’re in control — finish the check, then Resume.",
        );
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    return latest;
  }

  async function playBeats(
    sessionId: string,
    nextBeats: BrowserTeachBeat[],
    signal: AbortSignal,
    useFrames: boolean,
    lessonMatrix: BrowserLessonMatrix | null,
  ) {
    setPhase("teaching");
    let currentRole: "ground" | "truth" | null = null;
    let currentTabId: string | null = null;

    for (const beat of nextBeats) {
      if (signal.aborted) return;

      const paused = await waitWhileUserHasControl(sessionId, signal);
      if (signal.aborted) return;
      if (paused?.frameStream) {
        /* frames may still be needed after resume */
      }
      setPhase("teaching");

      const beatRole = beat.role ?? "truth";
      const beatTabId =
        beat.tabId ||
        (beatRole === "ground"
          ? lessonMatrix?.ground?.tabId
          : lessonMatrix?.truth?.tabId) ||
        null;

      // Multi-tab: activate the beat's tab as the transcript advances.
      if (beatTabId && beatTabId !== currentTabId) {
        try {
          const next = await activateBrowserTab(sessionId, beatTabId, signal);
          setSession(next);
          if (next.matrix) setMatrix(next.matrix);
          currentTabId = beatTabId;
          await new Promise((r) => setTimeout(r, 350));
          if (useFrames) await refreshFrame(sessionId);
        } catch {
          /* role switch below may still recover */
        }
      }

      if (beatRole !== currentRole) {
        if (
          lessonMatrix &&
          currentRole === "ground" &&
          beatRole === "truth" &&
          lessonMatrix.truth
        ) {
          setActiveRole("truth");
          setStatusLine("Switching to the Truth tab…");
          try {
            const next = await switchBrowserRole(sessionId, "truth", signal);
            setSession(next);
            if (next.matrix) setMatrix(next.matrix);
            currentTabId = next.activeTabId || lessonMatrix.truth.tabId || null;
            await new Promise((r) => setTimeout(r, 500));
            if (useFrames) await refreshFrame(sessionId);
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/You’re in control|in control of the browser/i.test(message)) {
              setPhase("awaiting_user");
              await waitWhileUserHasControl(sessionId, signal);
              if (signal.aborted) return;
              try {
                const next = await switchBrowserRole(
                  sessionId,
                  "truth",
                  signal,
                );
                setSession(next);
                if (next.matrix) setMatrix(next.matrix);
                currentTabId =
                  next.activeTabId || lessonMatrix.truth.tabId || null;
              } catch {
                pushNote("Could not open the Truth page — continuing.", "error");
              }
            } else {
              pushNote("Could not open the Truth page — continuing.", "error");
            }
          }
        } else {
          setActiveRole(beatRole);
        }
        currentRole = beatRole;
      }

      setActiveBeatId(beat.id);
      setStatusLine(beat.speech);
      pushNote(beat.speech, "narration");

      const kind = beat.annotation.kind;
      const isVideoAction =
        kind === "youtube_play" ||
        kind === "youtube_pause" ||
        kind === "youtube_seek";
      const isClick = kind === "click";

      // Pause again if the student took control mid-beat.
      await waitWhileUserHasControl(sessionId, signal);
      if (signal.aborted) return;
      setPhase("teaching");

      try {
        await annotateBrowserSession(sessionId, beat.annotation, signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (/You’re in control|in control of the browser/i.test(message)) {
          setPhase("awaiting_user");
          await waitWhileUserHasControl(sessionId, signal);
          if (signal.aborted) return;
          setPhase("teaching");
          try {
            await annotateBrowserSession(sessionId, beat.annotation, signal);
          } catch {
            /* keep teaching */
          }
        }
      }

      const settleMs = isVideoAction
        ? kind === "youtube_seek"
          ? 1400
          : 1100
        : isClick
          ? 1200
          : useFrames
            ? 400
            : 900;
      await new Promise((r) => setTimeout(r, settleMs));

      if (useFrames) {
        await refreshFrame(sessionId);
        if (!isVideoAction) {
          await new Promise((r) => setTimeout(r, 550));
          await refreshFrame(sessionId);
        }
      }

      await waitWhileUserHasControl(sessionId, signal);
      if (signal.aborted) return;
      setPhase("teaching");

      const spoken = await speakBrowserLine(beat.speech, signal);
      if (spoken) {
        await playAudio(spoken.mimeType, spoken.base64, signal);
      } else {
        await new Promise((r) =>
          setTimeout(r, Math.min(beat.speech.length * 35, 4000)),
        );
      }
      if (signal.aborted) return;

      const hold =
        beat.holdMs ?? (isVideoAction ? 1200 : isClick ? 1000 : 800);
      await new Promise((r) => setTimeout(r, hold));
    }

    try {
      await annotateBrowserSession(sessionId, { kind: "clear" }, signal);
      if (useFrames) await refreshFrame(sessionId);
    } catch {
      /* ignore */
    }
    setActiveBeatId(null);

    // If they took control right as teaching ended, wait for Resume before Act.
    await waitWhileUserHasControl(sessionId, signal);
    if (signal.aborted) return;

    const nextActQuestions = lessonMatrix?.act.questions ?? [];
    if (nextActQuestions.length && lessonMatrix?.roles.includes("act")) {
      setActActiveTracked(true);
      setActiveRole("act");
      // If they still hold control, keep awaiting_user so ControlBanner stays;
      // Act panel is shown via actActive either way.
      const held = await fetchBrowserSession(sessionId, signal);
      if (held?.userControl) {
        setSession(held);
        setPhase("awaiting_user");
      } else {
        setPhase("act");
      }
      setStatusLine("Act — check what stuck.");
      pushNote("Act: answer a couple of quick checks.", "summary");
      return;
    }

    setActActiveTracked(false);
    setPhase("ready");
    setStatusLine(
      "Ask a follow-up about this page, or a new topic to search again.",
    );
  }

  async function submitPrompt() {
    const text = prompt.trim();
    if (
      !text ||
      submittingRef.current ||
      phase === "working" ||
      phase === "teaching"
    ) {
      return;
    }

    if (!beginQuestion()) return;
    submittingRef.current = true;

    abortRef.current?.abort();
    teachAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const followUp = isFollowUpPrompt(text, {
      hasReadySession:
        Boolean(session?.id) && (phase === "ready" || phase === "act"),
      priorQuestion: priorQuestionRef.current || session?.question || "",
    });

    setPhase("working");
    setActiveBeatId(null);
    setActActiveTracked(false);
    phaseBeforeControlRef.current = null;
    if (!followUp) {
      noteSeqRef.current = 0;
      setNotes([{ id: "q-1", text, kind: "student" }]);
      setFrameDataUrl(null);
      setMatrix(null);
      setActiveRole(null);
      setCitedSources([]);
    } else {
      pushNote(text, "student");
    }
    setPrompt("");

    try {
      const result = followUp
        ? await requestBrowserFollowUp(session!.id, text, {
            signal: controller.signal,
            onEvent: onStreamEvent,
          })
        : await requestBrowserAsk(text, {
            sessionId: session?.id,
            signal: controller.signal,
            onEvent: onStreamEvent,
          });

      priorQuestionRef.current = text;
      setSession(result.session);
      const nextMatrix = result.session.matrix ?? matrix;
      if (nextMatrix) {
        setMatrix(nextMatrix);
        setActiveRole(nextMatrix.activeRole);
      }
      if (result.summary) pushNote(result.summary, "summary");

      const teachController = new AbortController();
      teachAbortRef.current = teachController;
      await playBeats(
        result.session.id,
        result.beats,
        teachController.signal,
        result.session.frameStream,
        followUp ? null : nextMatrix,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      cancelQuestion();
      setPhase("error");
      pushNote(
        toUserFacingError(
          err,
          "Could not start the browser lesson. Try again.",
        ),
        "error",
      );
    } finally {
      submittingRef.current = false;
    }
  }

  async function endSession() {
    abortRef.current?.abort();
    teachAbortRef.current?.abort();
    if (session?.id) await closeBrowserSession(session.id);
    setSession(null);
    setMatrix(null);
    setActiveRole(null);
    setFrameDataUrl(null);
    setActiveBeatId(null);
    setNotes([]);
    setCitedSources([]);
    setActActiveTracked(false);
    phaseBeforeControlRef.current = null;
    priorQuestionRef.current = "";
    setPhase("idle");
    setStatusLine(
      "Ask a question. We’ll open Ground → Truth, then Act checks.",
    );
  }

  async function onTakeControl() {
    if (!session?.id || controlBusy) return;
    setControlBusy(true);
    // Do NOT abort the teach loop — it pauses on userControl and continues
    // after Resume. Aborting here was killing narration after 1–2 toggles.
    // Remember Act so Resume can restore it; keep actActive mounted so the
    // questions never unmount while the user is clicking in the browser.
    phaseBeforeControlRef.current = actActiveRef.current ? "act" : phase;
    try {
      const next = await takeBrowserControl(
        session.id,
        "You’re in control — click the checkbox / puzzle in the browser pane, then Resume.",
      );
      setSession(next);
      if (!actActiveRef.current) {
        setPhase("awaiting_user");
      } else {
        // Keep phase "act" so strip/header stay consistent; banner still shows
        // because session.userControl is true.
        setPhase("act");
      }
      setStatusLine(
        next.challengeReason ||
          "You’re in control — finish the check in the pane, then Resume.",
      );
      pushNote(
        "You took control — click in the browser pane, then Resume.",
        "summary",
      );
      // Ensure a fresh frame so the hit layer has something to map onto.
      void refreshFrame(next.id);
    } catch (err) {
      phaseBeforeControlRef.current = null;
      pushNote(
        toUserFacingError(err, "Could not take control of the browser."),
        "error",
      );
    } finally {
      setControlBusy(false);
    }
  }

  async function onResumeControl() {
    if (!session?.id || controlBusy) return;
    setControlBusy(true);
    try {
      const next = await resumeBrowserControl(session.id);
      setSession(next);
      pushNote("Resumed — tutor has the browser again.", "summary");

      const prior = phaseBeforeControlRef.current;
      phaseBeforeControlRef.current = null;
      const teachAlive =
        teachAbortRef.current && !teachAbortRef.current.signal.aborted;

      // Act stays mounted via actActive; restore phase on Resume.
      if (
        (actActiveRef.current || prior === "act") &&
        matrix?.act.questions?.length &&
        matrix.roles.includes("act")
      ) {
        setActActiveTracked(true);
        setActiveRole("act");
        setPhase("act");
        setStatusLine("Act — check what stuck.");
        return;
      }

      // Teach loop still running (paused for Take control) — let playBeats continue;
      // it waits for Resume then advances into Act when Ground/Truth finish.
      if (teachAlive) {
        setPhase("teaching");
        setStatusLine("Continuing the lesson…");
        return;
      }

      setPhase(next.status === "ready" ? "ready" : "teaching");
      setStatusLine("Continuing the lesson…");
    } catch (err) {
      pushNote(
        toUserFacingError(err, "Could not resume the lesson yet."),
        "error",
      );
    } finally {
      setControlBusy(false);
    }
  }

  const busy = phase === "working" || phase === "teaching";
  const userControl = Boolean(session?.userControl) || phase === "awaiting_user";
  const sources = useMemo(
    () =>
      mergeLessonSources(
        citedSources,
        matrix?.ground?.source,
        matrix?.truth?.source,
        session?.selectedSource,
      ),
    [
      citedSources,
      matrix?.ground?.source,
      matrix?.truth?.source,
      session?.selectedSource,
    ],
  );
  const actQuestions = matrix?.act.questions ?? [];

  return (
    <AppShell>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader
          current="browser-experience"
          title="Browser"
          brandCompact
          className="sticky top-0 z-50"
          center={
            <PromptBar
              value={prompt}
              onChange={setPrompt}
              onSubmit={() => void submitPrompt()}
              disabled={busy || userControl}
              placeholder={
                userControl
                  ? "Finish the browser check, then Resume…"
                  : session && (phase === "ready" || phase === "act")
                    ? session.isYouTube
                      ? "Ask about another part of this video, or a new topic…"
                      : "Follow up on this page, or ask a new topic…"
                    : "Ask a page, or “explain this on YouTube”…"
              }
              submitLabel={
                session && (phase === "ready" || phase === "act")
                  ? "Ask"
                  : "Search"
              }
            />
          }
          actions={
            session ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void endSession()}
                className="h-8 shrink-0 px-2 text-[12px] text-[#5b7388]"
              >
                End
              </Button>
            ) : null
          }
          account={
            <div className="shrink-0">
              <AccountMenu
                onLogin={() => openAuth("login")}
                onSignup={() => openAuth("signup")}
                onLogout={logout}
              />
            </div>
          }
        />

        <main className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1.9fr)_minmax(260px,0.7fr)]">
          <div className="flex min-h-0 flex-col p-3 md:p-4 md:pr-2">
            {session ? (
              <ControlBanner
                reason={session.challengeReason ?? null}
                controlBusy={controlBusy}
                userControl={userControl}
                provider={session.provider}
                onTake={() => void onTakeControl()}
                onResume={() => void onResumeControl()}
              />
            ) : null}
            <div className="min-h-0 min-w-0 flex-1">
              <BrowserChrome
                className="h-full"
                addressBar={session?.addressBar || "about:blank"}
                liveViewUrl={session?.liveViewUrl ?? null}
                frameDataUrl={frameDataUrl}
                frameStream={Boolean(session?.frameStream)}
                interactive={userControl}
                localDesktop={session?.provider === "local"}
                tabs={session?.tabs ?? []}
                activeTabId={session?.activeTabId ?? null}
                tabsInteractive={userControl}
                onActivateTab={
                  userControl && session?.id
                    ? (tabId) => {
                        void activateBrowserTab(session.id, tabId)
                          .then((next) => {
                            setSession(next);
                            if (next.matrix) setMatrix(next.matrix);
                            void refreshFrame(session.id);
                          })
                          .catch(() => undefined);
                      }
                    : undefined
                }
                onCloseTab={
                  userControl &&
                  session?.id &&
                  (session.tabs?.length ?? 0) > 1
                    ? (tabId) => {
                        void closeBrowserTab(session.id, tabId)
                          .then((next) => {
                            setSession(next);
                            void refreshFrame(session.id);
                          })
                          .catch(() => undefined);
                      }
                    : undefined
                }
                onNewTab={
                  userControl && session?.id
                    ? () => {
                        void openBrowserTab(session.id)
                          .then((next) => {
                            setSession(next);
                            void refreshFrame(session.id);
                          })
                          .catch(() => undefined);
                      }
                    : undefined
                }
                onNavigate={
                  userControl && session?.id
                    ? (query) => {
                        void navigateBrowserOmnibox(session.id, query)
                          .then((next) => {
                            setSession(next);
                            void refreshFrame(session.id);
                          })
                          .catch(() => undefined);
                      }
                    : undefined
                }
                onReload={
                  userControl && session?.id
                    ? () => {
                        void reloadBrowserTab(session.id)
                          .then((next) => {
                            setSession(next);
                            void refreshFrame(session.id);
                          })
                          .catch(() => undefined);
                      }
                    : undefined
                }
                onPaneInput={
                  userControl && session?.id
                    ? (input: BrowserPaneInput) => {
                        // Brief pause so CAPTCHA tiles aren’t overwritten mid-click.
                        if (
                          input.type === "click" ||
                          input.type === "dblclick"
                        ) {
                          framePauseUntilRef.current = Date.now() + 450;
                        }
                        void sendBrowserInput(session.id, input)
                          .then(() => {
                            window.setTimeout(() => {
                              void refreshFrame(session.id);
                            }, 200);
                          })
                          .catch(() => {
                            /* keep trying — next click can succeed */
                          });
                      }
                    : undefined
                }
                statusLabel={
                  phase === "working" || phase === "awaiting_user"
                    ? statusLine
                    : session
                      ? statusLine
                      : "Ask a question to open the browser."
                }
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 md:p-4 md:pl-2">
            {actActive && actQuestions.length ? (
              <ActPanel
                key="browser-act-panel"
                questions={actQuestions}
                onDone={() => {
                  setActActiveTracked(false);
                  setPhase("ready");
                  setStatusLine(
                    "Ask a follow-up about this page, or a new topic to search again.",
                  );
                  pushNote("Act finished. Ask a follow-up anytime.", "summary");
                }}
              />
            ) : null}
            <BoardNarration
              title={session?.title || "Follow along"}
              lines={
                notes.length
                  ? notes
                  : phase === "working" || phase === "awaiting_user"
                    ? [
                        {
                          id: "status",
                          text: statusLine,
                          kind: "narration",
                        },
                      ]
                    : []
              }
              sources={sources}
              streaming={busy}
              placement="side"
            />
          </div>
        </main>
      </div>
    </AppShell>
  );
}
