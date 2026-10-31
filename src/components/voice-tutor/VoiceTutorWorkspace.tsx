"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FileDown,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  PanelLeft,
  Pause,
  Play,
} from "lucide-react";
import { HistoryRail } from "@/components/voice-tutor/HistoryRail";
import {
  ImageChoiceDialog,
  LessonMediaCard,
  type LessonMedia,
} from "@/components/voice-tutor/ImageLesson";
import {
  LessonStage,
  type LessonSection,
  type LessonStanza,
} from "@/components/voice-tutor/LessonStage";
import { VoiceOrb, type VoiceOrbState } from "@/components/voice-tutor/VoiceOrb";
import { LessonVideoJob } from "@/components/voice-tutor/lessonVideo";
import { LessonVideoPanel } from "@/components/voice-tutor/LessonVideoPanel";
import {
  setTeachFormats,
  TeachFormatPicker,
  useTeachFormats,
  type TeachFormats,
} from "@/components/voice-tutor/TeachFormatPicker";
import { BrandMark } from "@/components/lms/BrandMark";
import { StudyMenu } from "@/components/modes/ModeNav";
import { Button } from "@/components/ui/button";
import {
  LIVE_BARGE_ANSWERS,
  MAX_CHECK_QUESTION_REPEATS,
  MAX_TOPIC_CYCLES,
  casualFocusSay,
  cleanTopicLabel,
  displayHeardTranscript,
  extractTopicFromNudge,
  looksLikeAffirmative,
  looksLikeConfusionAside,
  looksLikeExcitementAck,
  looksIncompleteUtterance,
  looksLikeNegative,
  looksLikeParkLanguage,
  looksLikeRepeatQuestion,
  looksLikeTopicNudge,
  looksLikeVoiceInjection,
  isTopicSwitchAway,
  sanitizeVoiceTranscript,
  spokenTopicLockSay,
} from "@/lib/voice-tutor/intakeShared";
import {
  requestVoiceTurn,
} from "@/lib/voice-tutor/client";
import {
  VoiceDuplexSession,
  ensureMicPermission,
} from "@/lib/voice-tutor/duplexSession";
import { matchesWakePhrase } from "@/lib/voice-tutor/wakeWord";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { MAX_SCENE_REPAIR_ATTEMPTS } from "@/lib/scene-explain/types";
import {
  buildThreeModel,
  identifyLessonImage,
  repairThreeModel,
  model3dFileUrl,
  prepareLessonImage,
  startModel3d,
  waitForModel3d,
  type ImageIdentity,
} from "@/lib/voice-tutor/imageLesson";
import {
  deleteHistorySession,
  getHistorySession,
  listHistorySessions,
  saveHistorySession,
} from "@/lib/voice-tutor/historyStore";
import { exportVoiceSessionPdf } from "@/lib/voice-tutor/pdfExport";
import {
  avoidedFocusForParent,
  dynamicBargeLocked,
  dynamicBargeParked,
  dynamicDeferredIntro,
  dynamicExcitementAck,
  dynamicFinishLessonHold,
  dynamicLessonEnding,
  persistOfferedFocus,
} from "@/lib/voice-tutor/voiceVariety";
import type {
  BoardContent,
  ChatMessage,
  DrawScene,
  HistorySession,
  TeachBeat,
  TurnResponse,
  VoiceLessonPlan,
  VoicePhase,
} from "@/lib/voice-tutor/sessionTypes";

function mergeBoardContent(
  prev: BoardContent | null,
  next: BoardContent | null | undefined,
): BoardContent | null {
  if (!next) return prev;
  if (!prev) return next;
  return {
    ...prev,
    ...next,
    formalStatement: next.formalStatement || prev.formalStatement,
    sourceTitle: next.sourceTitle || prev.sourceTitle,
    sourceText: next.sourceText || prev.sourceText,
    highlight: next.highlight || prev.highlight,
    rememberTip: next.rememberTip || prev.rememberTip,
    examCue: next.examCue || prev.examCue,
    pointer: next.pointer || prev.pointer,
    sectionLabel: next.sectionLabel || prev.sectionLabel,
    plainExplain: next.plainExplain || prev.plainExplain,
    keyPoints: next.keyPoints?.length ? next.keyPoints : prev.keyPoints,
    annotations:
      next.annotations?.length ? next.annotations : prev.annotations,
  };
}

import { INSPECT_CHIP } from "@/lib/smart-tutor/chrome";
import { cn } from "@/lib/utils";

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeDontKnow(text: string): boolean {
  return /\b(i\s*don'?t\s*know|dont\s*know|no\s*idea|not\s*sure|idk|i'?m\s*not\s*sure|no\s*clue|pass|skip(?:\s+it)?)\b/i.test(
    text,
  );
}

function assessBeat(
  beat: TeachBeat,
  answer: string,
): { ok: boolean; say: string; unsure: boolean } {
  const normalized = normalize(answer);
  const unsure = looksLikeDontKnow(answer);
  if (!normalized) {
    return {
      ok: false,
      unsure: true,
      say: beat.hintSay || "In your own words — what's the piece that matters?",
    };
  }
  const keywordPool = [
    ...beat.rubricKeywords,
    ...(beat.board?.highlight
      ? beat.board.highlight.split(/\s+/).filter((w) => w.length > 3)
      : []),
  ];
  if (!keywordPool.length) {
    return {
      ok: true,
      unsure: false,
      say: beat.successSay || "Nice — that works. Moving on.",
    };
  }
  const hits = keywordPool.filter((k) => normalized.includes(normalize(k)));
  if (hits.length > 0) {
    return {
      ok: true,
      unsure: false,
      say: beat.successSay || "Yep — you've got that piece.",
    };
  }
  return {
    ok: false,
    unsure,
    say:
      beat.hintSay ||
      "Close — think about the marked line. What's the rule you'd actually use?",
  };
}

function firstCheckNudge(beat: TeachBeat, unsure: boolean): string {
  const hint =
    beat.hintSay ||
    "Look at the marked line — what would you write if this were an exam?";
  if (unsure) {
    return `All good. ${hint} Take another swing.`;
  }
  return `${hint} Try once more.`;
}

function scaffoldHalfAnswer(beat: TeachBeat): string {
  const idea =
    beat.board?.rememberTip ||
    beat.board?.highlight ||
    beat.board?.formalStatement;
  if (idea) {
    return `Alright — let me walk you through about half of it. ${idea} Want to take a shot at finishing the rest?`;
  }
  return "Alright — I'll sketch about half the answer from the marked line. Want to try finishing it?";
}

function scaffoldFullAnswer(beat: TeachBeat): string {
  const idea =
    beat.board?.rememberTip ||
    beat.board?.highlight ||
    beat.board?.formalStatement;
  if (idea) {
    return `No stress — here's the full picture: ${idea}. You've got this for next time.`;
  }
  return "No stress — follow the marked line on the board; that's the full answer we'd write.";
}


function sectionsFromBeat(
  beat: TeachBeat | null,
  plan: VoiceLessonPlan | null,
): LessonSection[] {
  if (!beat?.board) return [];
  const sections: LessonSection[] = [];
  if (plan?.objective && beat.id === plan.beats[0]?.id) {
    sections.push({
      heading: "Today's focus",
      body: plan.objective,
    });
  }
  return sections;
}

/** Local gate so check answers aren't blocked when the LLM is down. */
function looksLikeOffTopicChitchat(text: string, activeTopic?: string): boolean {
  if (!activeTopic?.trim()) return false;
  if (
    /\b(because|since|so|therefore|input|output|example|means|equals|force|energy|light|space|time|mass|velocity)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /\b(how many languages|what languages|who are you|your name|joke|weather|sing|favorite)\b/i.test(
      text,
    ) ||
    (/\b(languages?|chatgpt|openai|are you (an )?ai)\b/i.test(text) &&
      !new RegExp(activeTopic.split(/\s+/)[0] ?? "____", "i").test(text))
  );
}

export function VoiceTutorWorkspace() {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [orbState, setOrbState] = useState<VoiceOrbState>("idle");
  const [micOn, setMicOn] = useState(false);
  const [userHeard, setUserHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<VoiceLessonPlan | null>(null);
  const [beatIndex, setBeatIndex] = useState(-1);
  const [draw, setDraw] = useState<DrawScene | null>(null);
  const [board, setBoard] = useState<BoardContent | null>(null);
  const [sections, setSections] = useState<LessonSection[]>([]);
  /** Persistent lyric paragraphs — each beat appends below. */
  const [stanzas, setStanzas] = useState<LessonStanza[]>([]);
  const [activeStanzaIndex, setActiveStanzaIndex] = useState(0);
  const [drawings, setDrawings] = useState<
    Array<{ title: string; scene: DrawScene }>
  >([]);
  const [pendingTopic, setPendingTopic] = useState<string | null>(null);
  /** Student's picture (or its 3D model) pinned above the lesson. */
  const [media, setMedia] = useState<LessonMedia | null>(null);
  /** Picked / dropped image waiting for "3D or as is". */
  const [pendingImage, setPendingImage] = useState<{ file: File; url: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const mediaAbortRef = useRef<AbortController | null>(null);
  const mediaUrlRef = useRef<string | null>(null);
  /** Tripo is still building — hold student speech until the model is ready. */
  const modelBuildingRef = useRef(false);
  /** One repair at a time — the viewer can report the same crash twice. */
  const sceneRepairingRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  /** Teach with: text / diagram / video (any mix, remembered per browser). */
  const formats = useTeachFormats();
  const formatsRef = useRef(formats);
  const [videoJob, setVideoJob] = useState<LessonVideoJob | null>(null);
  const videoJobRef = useRef<LessonVideoJob | null>(null);
  /** Video-only lesson: the video teaches, so voice beats are not delivered. */
  const videoOnlyLessonRef = useRef(false);
  /** Video-only: job started at topic lock, adopted by beginTeaching. */
  const earlyVideoRef = useRef<LessonVideoJob | null>(null);
  const [focusOptions, setFocusOptions] = useState<string[]>([]);
  /** Topic rounds used (1st topic + switches). Max 3 including the first. */
  const [topicCycles, setTopicCycles] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [sessionId, setSessionId] = useState(() => uid("vs"));
  const [sessionLabel, setSessionLabel] = useState("New conversation");
  const [textFallback, setTextFallback] = useState("");
  const [busy, setBusy] = useState(false);
  /** Lesson plan is being written — the stage shows a placeholder. */
  const [preparingLesson, setPreparingLesson] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  /** X pause — voice + transcript halt until user resumes. */
  const [lessonPaused, setLessonPaused] = useState(false);
  const [boardHaltWriting, setBoardHaltWriting] = useState(false);

  const playAbortRef = useRef<AbortController | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const duplexRef = useRef<VoiceDuplexSession | null>(null);
  const handleUserTextRef = useRef<(text: string) => Promise<void>>(
    async () => undefined,
  );
  const interruptSpeakingRef = useRef<() => void>(() => undefined);
  const flashUserHeardRef = useRef<(text: string) => void>(() => undefined);
  const speakRef = useRef<
    (text: string, opts?: { log?: boolean }) => Promise<boolean>
  >(async () => false);
  const phaseRef = useRef(phase);
  const planRef = useRef(plan);
  const beatIndexRef = useRef(beatIndex);
  const micOnRef = useRef(micOn);
  const messagesRef = useRef(messages);
  const sessionIdRef = useRef(sessionId);
  const busyRef = useRef(busy);
  const speakingRef = useRef(false);
  const listenLoopActiveRef = useRef(false);
  const userHeardTimerRef = useRef<number | null>(null);
  const topicCyclesRef = useRef(0);
  const lastParentRef = useRef<string | null>(null);
  /** Third topic path: after subtopic pick, start — no more switches. */
  const finalAttemptRef = useRef(false);
  const focusOptionsRef = useRef<string[]>([]);
  const pendingTopicRef = useRef<string | null>(null);
  /** Failed check attempts on the current expectAnswer beat. */
  const checkHintCountRef = useRef(0);
  /** How many times we've re-spoken the same check question. */
  const checkRepeatCountRef = useRef(0);
  const startListenLoopRef = useRef<() => void>(() => undefined);
  /** Barge-in cut mid-beat — resume should advance, not re-speak the same line. */
  const skipCurrentBeatOnResumeRef = useRef(false);
  /** Questions deferred to end-of-lesson (voice + board). */
  const deferredQueriesRef = useRef<string[]>([]);
  /** Remaining parked questions waiting for incremental close-out. */
  const deferredQueueRef = useRef<string[]>([]);
  /** Active end-of-lesson scaffold (25% → 25% → full). */
  const deferredActiveRef = useRef<{
    question: string;
    piece1: string;
    piece2: string;
    full: string;
    step: 1 | 2 | 3;
  } | null>(null);
  const asideConfirmTimerRef = useRef<number | null>(null);
  const bargeIdleResumeTimerRef = useRef<number | null>(null);
  const pendingAsideQuestionRef = useRef<string | null>(null);
  /** Mid-lesson doubt barge-ins (first LIVE_BARGE_ANSWERS answered live). */
  const bargeDoubtCountRef = useRef(0);
  const bargeLockedRef = useRef(false);
  const lessonPausedRef = useRef(false);
  /** After barge-in, use a shorter end-of-turn so the next line is heard quickly. */
  const postBargeListenRef = useRef(false);
  const OVER_LIMIT_SAY =
    "You've changed topics more than three times. Pick a subtopic and we'll start — or end the lesson and begin a new one if you want something else.";

  /** Offline clarify fallback — content-ish, never theory/apps/general shells. */
  function forceClarifyTurn(topicRaw: string): TurnResponse {
    const parent = cleanTopicLabel(
      extractTopicFromNudge(topicRaw) || topicRaw.trim(),
    );
    const focusOptions = [
      `${parent} mechanisms`,
      `${parent} landmark ideas`,
      `hands-on ${parent}`,
      `${parent} big picture`,
    ];
    return {
      say: casualFocusSay(parent, focusOptions),
      action: "clarify_focus",
      parentTopic: parent,
      topic: parent,
      focusOptions,
      showOnBoard: false,
    };
  }

  function rememberOfferedFocus(parent: string, options: string[]) {
    const key = cleanTopicLabel(parent).toLowerCase();
    persistOfferedFocus(key, options);
  }

  function avoidedFocusFor(parent: string): string[] {
    return avoidedFocusForParent(cleanTopicLabel(parent));
  }

  /** Subtopic / same-family labels must not burn an extra try. */
  function isSameTopicFamily(candidate: string, parent: string): boolean {
    const c = candidate.trim().toLowerCase();
    const p = parent.trim().toLowerCase();
    if (!c || !p) return false;
    if (c === p) return true;
    if (c.includes(p) || p.includes(c)) return true;
    return focusOptionsRef.current.some((o) => {
      const x = o.trim().toLowerCase();
      return Boolean(x) && (c === x || c.includes(x) || x.includes(c));
    });
  }

  /**
   * Count a topic round when a NEW parent is established (first + each real switch).
   * Subtopic picks under the current parent do not increment.
   * Over-limit = attempting a 4th topic after 3 are used.
   */
  function registerTopicRound(parent: string): {
    round: number;
    isFinal: boolean;
    isOverLimit: boolean;
  } {
    const key = parent.trim().toLowerCase();
    const round = topicCyclesRef.current;
    if (!key) {
      return {
        round,
        isFinal: round >= MAX_TOPIC_CYCLES,
        isOverLimit: false,
      };
    }
    if (lastParentRef.current && isSameTopicFamily(key, lastParentRef.current)) {
      return {
        round,
        isFinal: round >= MAX_TOPIC_CYCLES,
        isOverLimit: false,
      };
    }
    // Already used all 3 — this would be a 4th topic.
    if (round >= MAX_TOPIC_CYCLES) {
      return { round, isFinal: true, isOverLimit: true };
    }
    topicCyclesRef.current = round + 1;
    lastParentRef.current = key;
    setTopicCycles(topicCyclesRef.current);
    const isFinal = topicCyclesRef.current >= MAX_TOPIC_CYCLES;
    if (isFinal) finalAttemptRef.current = true;
    return {
      round: topicCyclesRef.current,
      isFinal,
      isOverLimit: false,
    };
  }

  useEffect(() => {
    focusOptionsRef.current = focusOptions;
  }, [focusOptions]);
  useEffect(() => {
    pendingTopicRef.current = pendingTopic;
  }, [pendingTopic]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    formatsRef.current = formats;
  }, [formats]);
  useEffect(
    () => () => {
      videoJobRef.current?.cancel();
      earlyVideoRef.current?.cancel();
      mediaAbortRef.current?.abort();
      if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    },
    [],
  );
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  useEffect(() => {
    beatIndexRef.current = beatIndex;
  }, [beatIndex]);
  useEffect(() => {
    micOnRef.current = micOn;
  }, [micOn]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const refreshHistory = useCallback(() => {
    setHistory(listHistorySessions());
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const persist = useCallback(
    (patch?: Partial<HistorySession>) => {
      const base: HistorySession = {
        id: sessionIdRef.current,
        label: sessionLabel,
        topic: planRef.current?.topic || pendingTopic || sessionLabel,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: messagesRef.current,
        objective: planRef.current?.objective,
        ended: phaseRef.current === "ended",
        ...patch,
      };
      const existing = getHistorySession(sessionIdRef.current);
      saveHistorySession({
        ...base,
        createdAt: existing?.createdAt ?? base.createdAt,
        label: patch?.label || sessionLabel,
      });
      refreshHistory();
    },
    [pendingTopic, refreshHistory, sessionLabel],
  );

  function stopPlayback() {
    playAbortRef.current?.abort();
    playAbortRef.current = null;
    duplexRef.current?.abortSpeak();
    speakingRef.current = false;
  }

  function clearBargeIdleResumeTimer() {
    if (bargeIdleResumeTimerRef.current) {
      window.clearTimeout(bargeIdleResumeTimerRef.current);
      bargeIdleResumeTimerRef.current = null;
    }
  }

  /** Hard interrupt: kill TTS + in-flight turn, halt board writing, listen. */
  function interruptSpeaking() {
    // Still allow barge recognition after the 3rd park — just don't partial-answer.
    if (lessonPausedRef.current) return;
    const phaseNow = phaseRef.current;
    const midLesson =
      phaseNow === "teaching" ||
      phaseNow === "checking" ||
      phaseNow === "aside_confirm" ||
      phaseNow === "check_offer_try" ||
      phaseNow === "deferred_close";

    // Clarify / lock / greet: only cut TTS. Do NOT abort the in-flight topic
    // commit — trailing speech after a subtopic pick used to cancel the start.
    if (!midLesson) {
      stopPlayback();
      return;
    }

    postBargeListenRef.current = true;
    if (phaseNow === "teaching" || phaseNow === "checking") {
      skipCurrentBeatOnResumeRef.current = true;
      setBoardHaltWriting(true);
      clearBargeIdleResumeTimer();
      // Auto-resume only after a quiet window — longer so we don't steal speech.
      bargeIdleResumeTimerRef.current = window.setTimeout(() => {
        bargeIdleResumeTimerRef.current = null;
        if (
          !busyRef.current &&
          !listenLoopActiveRef.current &&
          (phaseRef.current === "teaching" || phaseRef.current === "checking")
        ) {
          setBoardHaltWriting(false);
          void resumeLessonAfterAside();
        }
      }, 10000);
    }
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    stopPlayback();
    duplexRef.current?.setPostBarge(true);
    busyRef.current = false;
    setBusy(false);
    setOrbState("listening");
    if (micOnRef.current && phaseRef.current !== "ended") {
      duplexRef.current?.startListening();
    }
  }

  /** X = pause lesson (voice + transcript). Resume only on request. */
  function pauseLesson() {
    lessonPausedRef.current = true;
    setLessonPaused(true);
    setBoardHaltWriting(true);
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    duplexRef.current?.pause();
    speakingRef.current = false;
    listenLoopActiveRef.current = false;
    clearAsideConfirmTimer();
    clearBargeIdleResumeTimer();
    busyRef.current = false;
    setBusy(false);
    setOrbState("idle");
  }

  function resumePausedLesson() {
    lessonPausedRef.current = false;
    setLessonPaused(false);
    setBoardHaltWriting(false);
    const phaseNow = phaseRef.current;
    const currentPlan = planRef.current;

    // Checking / deferred close-out: just listen again — don't skip content.
    if (
      phaseNow === "checking" ||
      phaseNow === "deferred_close" ||
      phaseNow === "check_offer_try" ||
      phaseNow === "aside_confirm"
    ) {
      if (micOnRef.current) {
        setOrbState("listening");
        duplexRef.current?.resumeListening();
        startListenLoopRef.current();
      } else {
        setOrbState("idle");
      }
      return;
    }

    // Teaching: re-deliver the current beat so a cut line isn't skipped.
    if (phaseNow === "teaching" && currentPlan && beatIndexRef.current >= 0) {
      if (micOnRef.current) {
        duplexRef.current?.resumeListening();
      }
      skipCurrentBeatOnResumeRef.current = false;
      void deliverBeat(currentPlan, beatIndexRef.current);
      return;
    }

    if (micOnRef.current) {
      setOrbState("listening");
      duplexRef.current?.resumeListening();
      startListenLoopRef.current();
    } else {
      setOrbState("idle");
    }
  }

  function togglePauseLesson() {
    if (lessonPausedRef.current) resumePausedLesson();
    else pauseLesson();
  }

  function stopListening() {
    duplexRef.current?.stopListening();
    listenLoopActiveRef.current = false;
  }

  function clearAsideConfirmTimer() {
    if (asideConfirmTimerRef.current) {
      window.clearTimeout(asideConfirmTimerRef.current);
      asideConfirmTimerRef.current = null;
    }
  }

  function pushBoardNote(note: string, title = "Quick clarify") {
    const text = note.trim();
    if (!text) return;
    setStanzas((prev) => [
      ...prev,
      {
        id: uid("aside"),
        text,
        rememberTip: title,
        pointer: "both" as const,
      },
    ]);
    setActiveStanzaIndex((idx) => Math.max(idx, 0));
  }

  /** Wipe pedagogy so a topic switch never stacks under the previous lesson. */
  function cancelLessonVideo() {
    videoJobRef.current?.cancel();
    videoJobRef.current = null;
    setVideoJob(null);
    videoOnlyLessonRef.current = false;
  }

  /** Start (or restart) the background video explainer for `topic`. */
  function startLessonVideo(topic: string): LessonVideoJob {
    videoJobRef.current?.cancel();
    // Reuse a video-only job already filming since topic lock.
    const early = earlyVideoRef.current;
    earlyVideoRef.current = null;
    const job = early && early.status.kind !== "cancelled" ? early : new LessonVideoJob(topic);
    videoJobRef.current = job;
    setVideoJob(job);
    return job;
  }

  /** Speak once when this lesson's video is ready (video-only lessons). */
  function announceVideoWhenReady(job: LessonVideoJob) {
    const off = job.subscribe(() => {
      const status = job.status;
      if (status.kind === "ready" || status.kind === "error" || status.kind === "cancelled") {
        off();
        if (videoJobRef.current !== job || lessonPausedRef.current) return;
        if (status.kind === "ready") {
          void speak(`Your video on ${job.topic} is ready — press play. Ask me anything while you watch.`);
        } else if (status.kind === "error") {
          void speak("The video didn't come through this time. Turn on text or diagrams and I'll teach it here instead.");
        }
      }
    });
  }

  function onFormatsChange(next: TeachFormats) {
    setTeachFormats(next);
    const lesson = planRef.current;
    const teachingNow = phaseRef.current === "teaching" || phaseRef.current === "checking";
    if (!lesson || !teachingNow) return;
    if (next.video && !videoJobRef.current) {
      startLessonVideo(lesson.topic);
    } else if (!next.video && videoJobRef.current) {
      videoJobRef.current.cancel();
      videoJobRef.current = null;
      setVideoJob(null);
    }
    // Leaving video-only mid-lesson: start the written/drawn lesson now.
    if (videoOnlyLessonRef.current && (next.text || next.diagram)) {
      videoOnlyLessonRef.current = false;
      if (beatIndexRef.current < 0) void deliverBeat(lesson, 0);
    }
  }

  function clearLessonBoard() {
    cancelLessonVideo();
    setBoard(null);
    setDraw(null);
    setSections([]);
    setStanzas([]);
    setActiveStanzaIndex(0);
    setDrawings([]);
    setBeatIndex(-1);
    beatIndexRef.current = -1;
  }

  const pushMessage = useCallback((role: "user" | "tutor", text: string) => {
    const msg: ChatMessage = {
      id: uid("m"),
      role,
      text,
      at: Date.now(),
    };
    // Update the ref now — the next turn request may fire before React renders.
    messagesRef.current = [...messagesRef.current, msg];
    setMessages(messagesRef.current);
    return msg;
  }, []);

  const flashUserHeard = useCallback((text: string) => {
    const shown = displayHeardTranscript(text);
    if (!shown) return;
    setUserHeard(shown);
    if (userHeardTimerRef.current) window.clearTimeout(userHeardTimerRef.current);
    userHeardTimerRef.current = window.setTimeout(() => {
      setUserHeard("");
      userHeardTimerRef.current = null;
    }, 5500);
  }, []);

  const applyBeatBoard = useCallback(
    (beat: TeachBeat, nextPlan: VoiceLessonPlan | null) => {
      setBoard((prev) => mergeBoardContent(prev, beat.board ?? null));
      const nextSections = sectionsFromBeat(beat, nextPlan);
      if (nextSections.length > 0) setSections(nextSections);

      const text = beat.board?.sourceText?.trim();
      if (text) {
        setStanzas((prev) => {
          if (prev.some((s) => s.text === text)) return prev;
          const next: LessonStanza = {
            id: `${beat.id}_${prev.length}`,
            text,
            annotations: beat.board?.annotations,
            highlight: beat.board?.highlight,
            rememberTip: beat.board?.rememberTip,
            examCue: beat.board?.examCue,
            pointer: beat.board?.pointer ?? "both",
            heading: beat.board?.sectionLabel,
          };
          // If this is the first stanza, keep active at 0; otherwise
          // advance active index only after the previous finishes (onStanzaComplete).
          if (prev.length === 0) setActiveStanzaIndex(0);
          return [...prev, next];
        });
      }

      if (beat.draw && beat.draw.kind !== "none") {
        setDraw(beat.draw);
        setDrawings((prev) => [
          ...prev,
          { title: beat.draw?.title || "Diagram", scene: beat.draw! },
        ]);
      }
    },
    [],
  );

  const onStanzaComplete = useCallback((index: number) => {
    setActiveStanzaIndex((current) => {
      // Move to the next queued stanza once this one finished writing.
      if (index !== current) return current;
      return current + 1;
    });
  }, []);

  /**
   * Tutor TTS via continuous duplex session.
   * Mic off only stops listening — tutor still speaks.
   * Pause (X) is the only hard mute for tutor audio.
   * `allowBarge: false` for topic-lock lines so a subtopic pick can't cancel commit.
   */
  async function speak(
    text: string,
    opts?: { log?: boolean; allowBarge?: boolean },
  ) {
    if (opts?.log !== false) pushMessage("tutor", text);
    if (lessonPausedRef.current) {
      setOrbState("idle");
      return false;
    }
    const duplex = duplexRef.current;
    if (!duplex) return false;
    speakingRef.current = true;
    setOrbState("speaking");
    try {
      return await duplex.speak(text, { allowBarge: opts?.allowBarge });
    } catch (err) {
      if ((err as Error).name === "AbortError") return false;
      setError(toUserFacingError(err, "Couldn't play that line."));
      return false;
    } finally {
      speakingRef.current = false;
    }
  }

  async function finishLessonEnding(nextPlan: VoiceLessonPlan) {
    deferredActiveRef.current = null;
    deferredQueueRef.current = [];
    setPhase("ended");
    setOrbState(micOnRef.current ? "listening" : "idle");
    await speak(dynamicLessonEnding(nextPlan.topic));
    persist({ ended: true, label: nextPlan.label });
    if (micOnRef.current) startListenLoopRef.current();
  }

  /** Keep parked doubts unique so the same ask isn't answered twice at close-out. */
  function uniqueParkedQuestions(questions: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of questions) {
      const q = raw.trim();
      const key = normalize(q);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
    return out;
  }

  /** Ensure a parked doubt appears in the chat transcript when we revisit it. */
  function ensureParkedQuestionInTranscript(question: string) {
    const key = normalize(question);
    if (!key) return;
    const already = messagesRef.current.some(
      (m) => m.role === "user" && normalize(m.text) === key,
    );
    if (!already) pushMessage("user", question);
  }

  /**
   * End-of-lesson parked doubts: drip piece1 → piece2 → full across student tries.
   * Student can nail it on try 1 or 2 and we move on gracefully.
   */
  async function startNextDeferredCloseout(nextPlan: VoiceLessonPlan) {
    const question = deferredQueueRef.current.shift();
    if (!question) {
      await finishLessonEnding(nextPlan);
      return;
    }
    ensureParkedQuestionInTranscript(question);
    const lessonContext = currentLessonContext();
    setPhase("deferred_close");
    setOrbState("thinking");
    const shortAsk =
      question.length > 90 ? `${question.slice(0, 87).trim()}…` : question;
    try {
      const turn = await requestVoiceTurn({
        mode: "chat",
        userText: question,
        messages: messagesRef.current,
        activeTopic: nextPlan.topic,
        teaching: true,
        deferredClose: true,
        lessonContext,
      });
      const piece1 =
        turn.deferredPieces?.piece1?.trim() ||
        turn.say?.trim() ||
        `Here's the first piece on ${nextPlan.topic}. What's the next step you'd take?`;
      const piece2 =
        turn.deferredPieces?.piece2?.trim() ||
        (lessonContext.rememberTip
          ? `Next piece: ${lessonContext.rememberTip}. Can you finish from there?`
          : `Next piece — connect that lever to the stuck point. Want to try closing it?`);
      const full =
        turn.deferredPieces?.full?.trim() ||
        `Full picture on ${nextPlan.topic}: ${lessonContext.highlight || "use the marked idea when you answer."}`;
      // Prefer a board note that names their question; avoid pasting `full` twice
      // into voice later by keeping board text written-only.
      if (turn.boardNote?.trim()) {
        pushBoardNote(
          `Your earlier question: ${question}\n\n${turn.boardNote.trim()}`,
          "Revisited",
        );
      } else {
        pushBoardNote(
          `Your earlier question: ${question}\n\n${full}`,
          "Revisited",
        );
      }
      deferredActiveRef.current = {
        question,
        piece1,
        piece2,
        full,
        step: 1,
      };
      // Name the ask once, then give only the first scaffold slice (not the full answer).
      const played = await speak(
        `${dynamicDeferredIntro()} you asked: ${shortAsk}. ${piece1} Want to take a shot at the rest?`,
      );
      if (!played) {
        await finishLessonEnding(nextPlan);
        return;
      }
      setOrbState(micOnRef.current ? "listening" : "idle");
      if (micOnRef.current) startListenLoopRef.current();
    } catch {
      pushBoardNote(
        `Parked question: ${question}. Re-read the marked lines on ${nextPlan.topic} — apply that piece when you answer.`,
        "Revisited",
      );
      const played = await speak(
        `${dynamicDeferredIntro()} you asked: ${shortAsk}. Check the new board note on ${nextPlan.topic}, then we'll wrap up.`,
      );
      if (!played) {
        await finishLessonEnding(nextPlan);
        return;
      }
      // Still advance the queue so later parked items aren't dropped.
      await startNextDeferredCloseout(nextPlan);
    }
  }

  async function deliverDeferredCloseouts(nextPlan: VoiceLessonPlan) {
    const pending = uniqueParkedQuestions(deferredQueriesRef.current);
    deferredQueriesRef.current = [];
    deferredQueueRef.current = pending;
    deferredActiveRef.current = null;
    if (!pending.length) {
      await finishLessonEnding(nextPlan);
      return;
    }
    await startNextDeferredCloseout(nextPlan);
  }

  async function handleDeferredCloseReply(text: string) {
    const nextPlan = planRef.current;
    const active = deferredActiveRef.current;
    if (!nextPlan || !active) {
      if (nextPlan) await finishLessonEnding(nextPlan);
      return;
    }

    // Student got it — encourage and move on (don't re-explain).
    const solidTry =
      (!looksLikeDontKnow(text) &&
        !looksLikeNegative(text) &&
        text.trim().split(/\s+/).length >= 4) ||
      (looksLikeAffirmative(text) && active.step > 1);
    if (solidTry && !looksLikeDontKnow(text) && !looksLikeNegative(text)) {
      const played = await speak(
        active.step === 1
          ? "Nice — you pulled that together. That's the idea."
          : "Yep — you've got it. Solid close-out.",
      );
      if (!played) return;
      deferredActiveRef.current = null;
      await startNextDeferredCloseout(nextPlan);
      return;
    }

    // Reveal next scaffold piece — each step should add new info, not re-lecture.
    if (active.step === 1) {
      deferredActiveRef.current = { ...active, step: 2 };
      const played = await speak(
        `${active.piece2} Take another swing if you want.`,
      );
      if (!played) return;
      setPhase("deferred_close");
      if (micOnRef.current) startListenLoopRef.current();
      return;
    }
    if (active.step === 2) {
      deferredActiveRef.current = { ...active, step: 3 };
      // One closing synthesis — don't restate piece1/piece2.
      const played = await speak(`Alright — putting it together: ${active.full}`);
      if (!played) return;
      deferredActiveRef.current = null;
      await startNextDeferredCloseout(nextPlan);
      return;
    }
    deferredActiveRef.current = null;
    await startNextDeferredCloseout(nextPlan);
  }

  async function deliverBeat(nextPlan: VoiceLessonPlan, index: number) {
    if (lessonPausedRef.current || videoOnlyLessonRef.current) return;
    const beat = nextPlan.beats[index];
    if (!beat) {
      await deliverDeferredCloseouts(nextPlan);
      return;
    }
    setBeatIndex(index);
    beatIndexRef.current = index;
    setBoardHaltWriting(false);
    if (beat.expectAnswer) {
      checkHintCountRef.current = 0;
      checkRepeatCountRef.current = 0;
    }
    setPhase(beat.expectAnswer ? "checking" : "teaching");
    applyBeatBoard(beat, nextPlan);
    const played = await speak(beat.say);
    if (!played) return;
    if (beat.expectAnswer) {
      setOrbState(micOnRef.current ? "listening" : "idle");
      if (micOnRef.current) startListenLoopRef.current();
      return;
    }
    await deliverBeat(nextPlan, index + 1);
  }

  async function beginTeaching(nextPlan: VoiceLessonPlan) {
    clearAsideConfirmTimer();
    clearBargeIdleResumeTimer();
    deferredQueriesRef.current = [];
    deferredQueueRef.current = [];
    deferredActiveRef.current = null;
    bargeDoubtCountRef.current = 0;
    bargeLockedRef.current = false;
    checkRepeatCountRef.current = 0;
    setBoardHaltWriting(false);
    lessonPausedRef.current = false;
    setLessonPaused(false);
    setPendingTopic(null);
    pendingTopicRef.current = null;
    const cleaned: VoiceLessonPlan = {
      ...nextPlan,
      topic: cleanTopicLabel(nextPlan.topic),
      label: cleanTopicLabel(nextPlan.label || nextPlan.topic),
    };
    setPlan(cleaned);
    planRef.current = cleaned;
    setSessionLabel(cleaned.label);
    clearLessonBoard();
    setPhase("teaching");
    persist({
      label: cleaned.label,
      topic: cleaned.topic,
      ended: false,
    });
    const chosen = formatsRef.current;
    if (chosen.video) {
      const job = startLessonVideo(cleaned.topic);
      if (!chosen.text && !chosen.diagram) {
        videoOnlyLessonRef.current = true;
        announceVideoWhenReady(job);
        await speak(
          `I'm making you a short video on ${cleaned.topic}. It takes a minute or two — I'll tell you when it's ready.`,
        );
        return;
      }
    }
    await deliverBeat(cleaned, 0);
  }

  /**
   * Confirm a focus for the current topic round, then start teaching.
   * Round 3 wording is final (no more switches this session).
   */
  async function acceptProposedTopic(
    topic: string,
    nextPlan: VoiceLessonPlan,
    say: string,
    opts?: { alreadySpoken?: boolean },
  ) {
    // Keep focusOptions until teaching starts — needed if they nudge over the limit.
    const isFinal =
      finalAttemptRef.current || topicCyclesRef.current >= MAX_TOPIC_CYCLES;
    finalAttemptRef.current = isFinal;
    const cleanTopic = cleanTopicLabel(topic);
    const cleanPlan = {
      ...nextPlan,
      topic: cleanTopicLabel(nextPlan.topic),
      label: cleanTopicLabel(nextPlan.label || nextPlan.topic),
    };

    if (lessonPausedRef.current) return;

    if (!opts?.alreadySpoken) {
      const teasers =
        cleanPlan.beats[0]?.board?.keyPoints?.filter(Boolean).slice(0, 3) ?? [];
      const line = isFinal
        ? spokenTopicLockSay(cleanTopic, { final: true })
        : spokenTopicLockSay(cleanTopic, { teasers });
      // Prefer our clean lock line over any echoed model say.
      // No barge: trailing audio after the pick must not cancel the start.
      await speak(/\bi want to learn\b/i.test(say) ? line : say || line, {
        allowBarge: false,
      });
    }

    if (lessonPausedRef.current) return;

    finalAttemptRef.current = false;
    await beginTeaching(cleanPlan);
  }

  async function resumeLessonAfterAside() {
    clearAsideConfirmTimer();
    clearBargeIdleResumeTimer();
    pendingAsideQuestionRef.current = null;
    const currentPlan = planRef.current;
    const idx = beatIndexRef.current;
    if (!currentPlan || idx < 0) {
      if (micOnRef.current) startListenLoopRef.current();
      return;
    }
    skipCurrentBeatOnResumeRef.current = false;
    const beat = currentPlan.beats[idx];
    // Check beat: stay and listen — don't skip the question.
    if (beat?.expectAnswer) {
      setPhase("checking");
      setBoardHaltWriting(false);
      if (micOnRef.current) startListenLoopRef.current();
      return;
    }
    // Teaching: board for this beat is already on screen — advance, don't re-read it.
    setPhase("teaching");
    setBoardHaltWriting(false);
    await deliverBeat(currentPlan, idx + 1);
  }

  function armAsideConfirmListen() {
    clearAsideConfirmTimer();
    setPhase("aside_confirm");
    // No reply → assume clear and continue.
    asideConfirmTimerRef.current = window.setTimeout(() => {
      asideConfirmTimerRef.current = null;
      if (phaseRef.current !== "aside_confirm") return;
      void resumeLessonAfterAside();
    }, 9000);
    if (micOnRef.current) {
      setOrbState("listening");
      startListenLoopRef.current();
    }
  }

  function currentLessonContext() {
    const plan = planRef.current;
    const beat = plan?.beats[beatIndexRef.current];
    return {
      beatSay: beat?.say,
      highlight: beat?.board?.highlight,
      rememberTip: beat?.board?.rememberTip,
    };
  }

  /**
   * Mid-lesson doubt handling:
   * first LIVE_BARGE_ANSWERS → partial voice answer NOW (not on board), resume SAME beat
   * further doubts → park for end (incremental close-out), lock further partials
   */
  async function handleLessonDoubt(question: string) {
    const topic = planRef.current?.topic;
    if (!topic) {
      await resumeLessonAfterAside();
      return;
    }
    clearBargeIdleResumeTimer();
    setBoardHaltWriting(true);
    flashUserHeard(question);
    // After a doubt, stay on this beat — don't skip past the teaching line.
    skipCurrentBeatOnResumeRef.current = false;

    if (bargeLockedRef.current) {
      deferredQueriesRef.current.push(question);
      const played = await speak(dynamicBargeLocked());
      if (played) {
        setBoardHaltWriting(false);
        await resumeLessonAfterAside();
      }
      return;
    }

    bargeDoubtCountRef.current += 1;
    const count = bargeDoubtCountRef.current;

    // After the live budget → park for end (answered incrementally at close-out).
    if (count > LIVE_BARGE_ANSWERS) {
      deferredQueriesRef.current.push(question);
      bargeLockedRef.current = true;
      const played = await speak(dynamicBargeParked());
      if (played) {
        setBoardHaltWriting(false);
        await resumeLessonAfterAside();
      }
      return;
    }

    // Live doubts → partial voice-only answer with lesson context (never "later").
    setOrbState("thinking");
    const lessonContext = currentLessonContext();
    const liveFallback = lessonContext.highlight
      ? `Here's one piece now: ${lessonContext.highlight}. We'll keep building from there.`
      : `Here's one piece of ${topic} now — we'll keep building from there.`;
    try {
      const turn = await requestVoiceTurn({
        mode: "chat",
        userText: question,
        messages: messagesRef.current,
        activeTopic: topic,
        teaching: true,
        partialAside: true,
        lessonContext,
        signal: turnAbortRef.current?.signal,
      });
      let line = turn.say.trim() || liveFallback;
      if (looksLikeParkLanguage(line)) line = liveFallback;
      const played = await speak(line);
      if (!played) return;
      setBoardHaltWriting(false);
      await resumeLessonAfterAside();
    } catch {
      const played = await speak(liveFallback);
      if (played) {
        setBoardHaltWriting(false);
        await resumeLessonAfterAside();
      }
    }
  }

  async function handleUserText(raw: string) {
    const text = sanitizeVoiceTranscript(raw);
    if (!text || busyRef.current) return;
    if (lessonPausedRef.current) {
      if (
        looksLikeAffirmative(text) ||
        /\b(continue|resume|keep going|unpause)\b/i.test(text)
      ) {
        resumePausedLesson();
      }
      return;
    }

    const phasePeek = phaseRef.current;

    if (modelBuildingRef.current) {
      flashUserHeard(text);
      const played = await speak(
        "Hang on — your 3D model is still building. I'll ask what you want to know as soon as it's ready.",
        { log: false },
      );
      if (played && micOnRef.current) startListenLoopRef.current();
      return;
    }

    if (looksLikeVoiceInjection(text)) {
      flashUserHeard(text);
      pushMessage("user", text);
      const played = await speak(
        "Let's keep this about what you want to learn. Name a topic — even a messy one is fine.",
      );
      if (played && micOnRef.current) startListenLoopRef.current();
      return;
    }

    // End-of-lesson parked doubts — incremental reveal with student tries.
    if (phasePeek === "deferred_close") {
      pushMessage("user", text);
      flashUserHeard(text);
      setBusy(true);
      busyRef.current = true;
      try {
        await handleDeferredCloseReply(text);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }

    // After ~50% scaffold — offer another try or finish the answer.
    if (phasePeek === "check_offer_try") {
      clearAsideConfirmTimer();
      pushMessage("user", text);
      flashUserHeard(text);
      const currentPlan = planRef.current;
      const beat = currentPlan?.beats[beatIndexRef.current];
      if (!currentPlan || !beat) {
        await resumeLessonAfterAside();
        return;
      }
      setBusy(true);
      busyRef.current = true;
      try {
        if (looksLikeNegative(text) || looksLikeDontKnow(text)) {
          const played = await speak(scaffoldFullAnswer(beat));
          if (!played) return;
          checkHintCountRef.current = 0;
          checkRepeatCountRef.current = 0;
          await deliverBeat(currentPlan, beatIndexRef.current + 1);
          return;
        }
        if (looksLikeAffirmative(text)) {
          const played = await speak(
            "Awesome — go ahead. What's your answer?",
          );
          if (!played) return;
          setPhase("checking");
          if (micOnRef.current) startListenLoopRef.current();
          return;
        }
        // Treat as an answer attempt.
        const result = assessBeat(beat, text);
        if (result.ok) {
          const played = await speak(result.say);
          if (!played) return;
          checkHintCountRef.current = 0;
          checkRepeatCountRef.current = 0;
          await deliverBeat(currentPlan, beatIndexRef.current + 1);
          return;
        }
        const played = await speak(scaffoldFullAnswer(beat));
        if (!played) return;
        checkHintCountRef.current = 0;
        checkRepeatCountRef.current = 0;
        await deliverBeat(currentPlan, beatIndexRef.current + 1);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }

    // Aside confirm: yes / silence-path / no→defer — allow short answers.
    if (phasePeek === "aside_confirm") {
      clearAsideConfirmTimer();
      pushMessage("user", text);
      flashUserHeard(text);
      if (looksLikeNegative(text)) {
        const parked = pendingAsideQuestionRef.current || text;
        deferredQueriesRef.current.push(parked);
        pendingAsideQuestionRef.current = null;
        setBusy(true);
        busyRef.current = true;
        try {
          const played = await speak(
            "Don't worry — at the end of the lesson I'll come back to that, on the board and out loud.",
          );
          if (played) await resumeLessonAfterAside();
        } finally {
          busyRef.current = false;
          setBusy(false);
        }
        return;
      }
      // yes / vague / anything else → continue
      pendingAsideQuestionRef.current = null;
      await resumeLessonAfterAside();
      return;
    }

    // Thinking pause / cut-off fragment — keep listening, don't burn a turn.
    if (looksIncompleteUtterance(text)) {
      if (micOnRef.current) startListenLoopRef.current();
      return;
    }
    clearBargeIdleResumeTimer();
    pushMessage("user", text);
    flashUserHeard(text);
    turnAbortRef.current?.abort();
    const turnAc = new AbortController();
    turnAbortRef.current = turnAc;
    setBusy(true);
    busyRef.current = true;
    setError(null);

    const phaseNow = phaseRef.current;
    const inActiveLesson =
      phaseNow === "teaching" || phaseNow === "checking";

    try {
      if (phaseNow === "checking") {
        const currentPlan = planRef.current;
        const beat = currentPlan?.beats[beatIndexRef.current];
        if (currentPlan && beat) {
          if (looksLikeExcitementAck(text)) {
            skipCurrentBeatOnResumeRef.current = false;
            if (micOnRef.current) startListenLoopRef.current();
            return;
          }
          if (looksLikeConfusionAside(text)) {
            await handleLessonDoubt(text);
            return;
          }
          // Same check question — repeat up to 3 times, then half-solve + offer try.
          if (looksLikeRepeatQuestion(text)) {
            checkRepeatCountRef.current += 1;
            if (checkRepeatCountRef.current <= MAX_CHECK_QUESTION_REPEATS) {
              const played = await speak(
                checkRepeatCountRef.current === 1
                  ? `Sure — same question: ${beat.say}`
                  : checkRepeatCountRef.current === 2
                    ? `No problem — here it is again: ${beat.say}`
                    : `Last time I'll restate it: ${beat.say}`,
              );
              if (!played) return;
              setPhase("checking");
              if (micOnRef.current) startListenLoopRef.current();
              return;
            }
            const played = await speak(scaffoldHalfAnswer(beat));
            if (!played) return;
            setPhase("check_offer_try");
            if (micOnRef.current) startListenLoopRef.current();
            return;
          }
          if (looksLikeOffTopicChitchat(text, currentPlan.topic)) {
            const played = await speak(
              `I can chat about lots of things, but right now I'm focused on ${currentPlan.topic}. Let's stay with that.`,
            );
            if (!played) return;
            setPhase("checking");
            if (micOnRef.current) startListenLoopRef.current();
            return;
          }
          const result = assessBeat(beat, text);
          if (result.ok) {
            checkHintCountRef.current = 0;
            checkRepeatCountRef.current = 0;
            const played = await speak(result.say);
            if (!played) return;
            await deliverBeat(currentPlan, beatIndexRef.current + 1);
            return;
          }

          // Conversational ladder: nudge → second nudge → half answer + offer try.
          checkHintCountRef.current += 1;
          if (checkHintCountRef.current >= 3) {
            const played = await speak(scaffoldHalfAnswer(beat));
            if (!played) return;
            setPhase("check_offer_try");
            if (micOnRef.current) startListenLoopRef.current();
            return;
          }
          const played = await speak(firstCheckNudge(beat, result.unsure));
          if (!played) return;
          setPhase("checking");
          if (micOnRef.current) startListenLoopRef.current();
          return;
        }
      }

      if (phaseNow === "teaching" && planRef.current) {
        // Excited barge-in ("damn", "wow") — keep teaching, don't burn a doubt slot.
        if (looksLikeExcitementAck(text)) {
          flashUserHeard(text);
          const played = await speak(dynamicExcitementAck());
          if (!played) return;
          setBoardHaltWriting(false);
          await resumeLessonAfterAside();
          return;
        }
        // Doubts / clarify asks first — never treat "explain that" as a topic switch.
        const looksLikeDoubt =
          looksLikeConfusionAside(text) ||
          /\?/.test(text) ||
          /\b(what|why|how|when|where|mean|unclear|confused|explain|repeat|clarify|don'?t get|didn'?t get)\b/i.test(
            text,
          );
        if (looksLikeDoubt) {
          await handleLessonDoubt(text);
          return;
        }
        // Only a clear topic *switch* holds the lesson for later.
        if (
          isTopicSwitchAway(
            text,
            planRef.current.topic,
            focusOptionsRef.current,
          ) ||
          looksLikeTopicNudge(text)
        ) {
          const played = await speak(dynamicFinishLessonHold());
          if (!played) return;
          setBoardHaltWriting(false);
          await resumeLessonAfterAside();
          return;
        }
        // Default mid-lesson speech → treat as a doubt (partial ×2, then park).
        await handleLessonDoubt(text);
        return;
      }

      // Onboarding / clarify: never mark as teaching.
      setOrbState("thinking");
      const awaitingFocus = phaseNow === "clarify_focus";
      if (turnAc.signal.aborted) return;
      const clarifyParent =
        (awaitingFocus
          ? pendingTopicRef.current
          : extractTopicFromNudge(text) || text) || "";
      let turn = await requestVoiceTurn({
        mode: "chat",
        userText: text,
        messages: messagesRef.current,
        activeTopic: inActiveLesson ? planRef.current?.topic : undefined,
        teaching: false,
        awaitingFocus,
        parentTopic: awaitingFocus
          ? pendingTopicRef.current || undefined
          : undefined,
        focusOptions: awaitingFocus ? focusOptionsRef.current : undefined,
        avoidedFocusOptions: avoidedFocusFor(clarifyParent),
        diagrams: formatsRef.current.diagram,
        signal: turnAc.signal,
      });
      if (turnAc.signal.aborted) return;

      // propose without a prior clarify pick → force subtopic ask (same as first time).
      if (
        turn.action === "propose_topic" &&
        turn.topic &&
        !awaitingFocus
      ) {
        turn = forceClarifyTurn(turn.topic);
      }

      if (turn.action === "clarify_focus") {
        const parent = turn.parentTopic || turn.topic || text;
        if (turn.focusOptions?.length) {
          rememberOfferedFocus(parent, turn.focusOptions);
        }
        const reg = registerTopicRound(parent);
        // Only after 3 topics are already used — not when entering the 3rd.
        if (reg.isOverLimit) {
          const stayParent =
            pendingTopicRef.current || lastParentRef.current || parent;
          const stayOpts =
            focusOptionsRef.current.length > 0
              ? focusOptionsRef.current
              : [
                  `${stayParent} core ideas`,
                  `${stayParent} worked example`,
                  `general ${stayParent}`,
                ];
          await speak(OVER_LIMIT_SAY);
          await speak(casualFocusSay(stayParent, stayOpts));
          setFocusOptions(stayOpts);
          focusOptionsRef.current = stayOpts;
          setPhase("clarify_focus");
          setPendingTopic(stayParent);
          pendingTopicRef.current = stayParent;
          if (micOnRef.current) {
            setOrbState("listening");
            startListenLoopRef.current();
          }
          return;
        }
        // Round 3: still ask subtopics normally — no "too many times" yet.
        const played = await speak(turn.say);
        if (!played) return;
        const opts = turn.focusOptions ?? [];
        setFocusOptions(opts);
        focusOptionsRef.current = opts;
        setPhase("clarify_focus");
        setPendingTopic(parent);
        pendingTopicRef.current = parent;
        if (micOnRef.current) {
          setOrbState("listening");
          startListenLoopRef.current();
        }
        return;
      }

      if (turn.action === "propose_topic" && turn.topic) {
        // Focus pick after clarify — never count the subtopic as a new round.
        if (!awaitingFocus) {
          const reg = registerTopicRound(turn.topic);
          if (reg.isOverLimit) {
            await speak(OVER_LIMIT_SAY);
            const stayParent = lastParentRef.current || turn.topic;
            const stayOpts = focusOptionsRef.current;
            if (stayOpts.length > 0) {
              await speak(casualFocusSay(stayParent, stayOpts));
              setPhase("clarify_focus");
              setPendingTopic(stayParent);
              pendingTopicRef.current = stayParent;
            } else {
              setPhase("chatting");
            }
            if (micOnRef.current) startListenLoopRef.current();
            return;
          }
        }
        const isFinalRound =
          finalAttemptRef.current ||
          topicCyclesRef.current >= MAX_TOPIC_CYCLES;
        // Video-only: start filming now, in parallel with lesson planning.
        // (With text/diagrams on it starts after the plan, so the video's
        // token use never delays the written lesson on rate-capped tiers.)
        const chosenNow = formatsRef.current;
        if (chosenNow.video && !chosenNow.text && !chosenNow.diagram) {
          earlyVideoRef.current?.cancel();
          earlyVideoRef.current = new LessonVideoJob(cleanTopicLabel(turn.topic));
        }
        let nextPlan: VoiceLessonPlan | null = turn.plan ?? null;
        let alreadySpoken = false;
        const topicClean = cleanTopicLabel(turn.topic);
        const teasers =
          turn.plan?.beats[0]?.board?.keyPoints?.filter(Boolean).slice(0, 3) ??
          [];
        const spokenLine = isFinalRound
          ? spokenTopicLockSay(topicClean, { final: true })
          : spokenTopicLockSay(topicClean, { teasers });
        if (!nextPlan) {
          // Speak first so planning latency doesn't feel stuck.
          // No barge on lock line — pick residue must not cancel commit.
          await speak(spokenLine, { allowBarge: false });
          alreadySpoken = true;
          if (lessonPausedRef.current) return;
          setPreparingLesson(`Preparing your lesson on ${topicClean}…`);
          // One soft retry if the first plan call flakes.
          try {
            for (let attempt = 0; attempt < 2 && !nextPlan; attempt += 1) {
              if (lessonPausedRef.current) return;
              try {
                const planned = await requestVoiceTurn({
                  mode: "plan",
                  userText: turn.topic,
                  topic: turn.topic,
                  messages: messagesRef.current,
                  diagrams: formatsRef.current.diagram,
                  signal: turnAc.signal,
                });
                nextPlan = planned.plan ?? null;
              } catch (err) {
                // Pause aborts the signal; barge during clarify no longer does.
                if (
                  (err as Error).name === "AbortError" ||
                  turnAc.signal.aborted ||
                  lessonPausedRef.current
                ) {
                  return;
                }
              }
            }
          } finally {
            setPreparingLesson(null);
          }
        }
        if (nextPlan) {
          clearLessonBoard();
          await acceptProposedTopic(topicClean, nextPlan, spokenLine, {
            alreadySpoken,
          });
        } else {
          earlyVideoRef.current?.cancel();
          earlyVideoRef.current = null;
          // Recover into clarify instead of silently dying on the lock line.
          const stayParent =
            pendingTopicRef.current || lastParentRef.current || topicClean;
          const stayOpts = focusOptionsRef.current;
          await speak(
            "I hit a snag building that lesson — say the focus again and I'll retry.",
            { allowBarge: false },
          );
          if (stayOpts.length > 0) {
            setPhase("clarify_focus");
            setPendingTopic(stayParent);
            pendingTopicRef.current = stayParent;
            await speak(casualFocusSay(stayParent, stayOpts), {
              allowBarge: false,
            });
          } else {
            setPhase("chatting");
          }
          if (micOnRef.current) startListenLoopRef.current();
        }
        return;
      }

      const played = await speak(turn.say);
      if (played) {
        // Stay on clarify_focus so the next utterance can pick an option.
        if (phaseNow !== "clarify_focus") setPhase("chatting");
        if (micOnRef.current) startListenLoopRef.current();
        else setOrbState("idle");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError" || turnAc.signal.aborted) {
        /* barge-in / cancelled turn */
      } else {
        setError(toUserFacingError(err, "Couldn't continue."));
        setOrbState("error");
      }
    } finally {
      if (turnAbortRef.current === turnAc) turnAbortRef.current = null;
      busyRef.current = false;
      setBusy(false);
      persist();
      if (
        micOnRef.current &&
        !speakingRef.current &&
        phaseRef.current !== "ended"
      ) {
        startListenLoopRef.current();
      }
    }
  }

  const startListenLoop = useCallback(() => {
    if (!micOnRef.current) return;
    if (phaseRef.current === "ended") return;
    if (lessonPausedRef.current) return;
    if (speakingRef.current) return;
    setError(null);
    setOrbState("listening");
    duplexRef.current?.startListening();
  }, []);

  useEffect(() => {
    startListenLoopRef.current = startListenLoop;
  }, [startListenLoop]);

  // Keep pedagogy callbacks fresh without recreating the duplex mic session.
  handleUserTextRef.current = handleUserText;
  interruptSpeakingRef.current = interruptSpeaking;
  flashUserHeardRef.current = flashUserHeard;
  speakRef.current = speak;

  // Continuous duplex voice session — owns mic for the page lifetime.
  useEffect(() => {
    // Thinking pause cut the student off ("I want to learn about…") — hold the
    // fragment and prepend it to the next utterance instead of dropping it.
    const fragment = { text: "", at: 0 };
    const FRAGMENT_TTL_MS = 15_000;
    const withFragment = (text: string) => {
      if (!fragment.text || Date.now() - fragment.at > FRAGMENT_TTL_MS) {
        return text;
      }
      return `${fragment.text} ${text}`.trim();
    };
    const duplex = new VoiceDuplexSession({
      positiveSpeechThreshold: 0.55,
      bargeThreshold: 0.14,
      bargeSettleMs: 160,
      bargeHoldMs: 80,
      wakeWordEnabled: true,
      idleTimeoutMs: 45_000,
      getKeyterms: () => [
        "SeeThrough",
        ...(planRef.current?.topic ? [planRef.current.topic] : []),
        ...(pendingTopicRef.current ? [pendingTopicRef.current] : []),
        ...focusOptionsRef.current,
      ],
      onPartial: (partial) => {
        // In wake mode, only surface text that looks like a wake attempt.
        if (duplex.isWakeMode) {
          const hit = matchesWakePhrase(partial);
          if (!hit.matched && !/\b(hey|tutor|see)\b/i.test(partial)) return;
        }
        const shown = displayHeardTranscript(
          duplex.isWakeMode ? partial : withFragment(partial),
        );
        if (shown) setUserHeard(shown);
      },
      onFinal: async (transcript, meta) => {
        const cleaned = sanitizeVoiceTranscript(withFragment(transcript));
        if (!cleaned) {
          duplex.startListening();
          return;
        }
        if (!meta.afterBarge && looksIncompleteUtterance(cleaned)) {
          fragment.text = cleaned;
          fragment.at = Date.now();
          duplex.startListening();
          return;
        }
        fragment.text = "";
        postBargeListenRef.current = false;
        if (bargeIdleResumeTimerRef.current) {
          window.clearTimeout(bargeIdleResumeTimerRef.current);
          bargeIdleResumeTimerRef.current = null;
        }
        flashUserHeardRef.current(cleaned);
        listenLoopActiveRef.current = false;
        await handleUserTextRef.current(cleaned);
      },
      onWake: async ({ phrase, remainder }) => {
        flashUserHeardRef.current(phrase);
        // Short ack when they only woke the tutor (no follow-on command).
        if (!remainder.trim() && !lessonPausedRef.current) {
          await speakRef.current("I'm here.", { log: true });
        }
      },
      onBarge: () => {
        interruptSpeakingRef.current();
      },
      onState: (state) => {
        speakingRef.current = state === "speaking";
        listenLoopActiveRef.current =
          state === "listening" ||
          state === "thinking" ||
          state === "wake";
        if (state === "wake") setOrbState("wake");
        else if (state === "listening") setOrbState("listening");
        else if (state === "thinking") setOrbState("thinking");
        else if (state === "speaking") setOrbState("speaking");
        else if (state === "paused" || state === "idle" || state === "ended") {
          if (!speakingRef.current) setOrbState("idle");
        }
      },
      onError: (message) => {
        setError(toUserFacingError(message, "Couldn't continue."));
      },
    });
    duplexRef.current = duplex;
    return () => {
      duplex.destroy();
      duplexRef.current = null;
    };
  }, []);

  async function toggleMic() {
    if (micOn) {
      // Student mic off only — do not cut tutor TTS mid-line.
      setMicOn(false);
      micOnRef.current = false;
      duplexRef.current?.setStudentMuted(true);
      if (!speakingRef.current) setOrbState("idle");
      return;
    }

    // Mic after End starts a clean session; the ended one stays in History.
    if (phase === "ended") newSession();

    setOrbState("connecting");
    const duplex = duplexRef.current;
    const ok = duplex ? await duplex.acquireMic() : await ensureMicPermission();
    if (!ok) {
      setError("Allow microphone access to talk. You can still type below.");
      setOrbState("idle");
      return;
    }
    setError(null);
    setMicOn(true);
    micOnRef.current = true;
    duplex?.setStudentMuted(false);

    if (phase === "idle" || phase === "ended" || messages.length === 0) {
      setPhase("greeting");
      setBusy(true);
      busyRef.current = true;
      try {
        const turn = await requestVoiceTurn({ mode: "greet", messages: [] });
        await speak(turn.say);
        setPhase("chatting");
      } catch (err) {
        setError(toUserFacingError(err, "Couldn't start the tutor."));
        setOrbState("error");
      } finally {
        busyRef.current = false;
        setBusy(false);
        speakingRef.current = false;
        if (micOnRef.current) startListenLoop();
      }
      return;
    }

    setOrbState("listening");
    startListenLoop();
  }

  /** Swap the pinned picture/model, freeing the old object URL. */
  function replaceMedia(next: LessonMedia | null) {
    const nextUrl = next?.imageUrl ?? null;
    if (mediaUrlRef.current && mediaUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(mediaUrlRef.current);
    }
    mediaUrlRef.current = nextUrl;
    setMedia(next);
  }

  function clearLessonMedia() {
    mediaAbortRef.current?.abort();
    mediaAbortRef.current = null;
    modelBuildingRef.current = false;
    replaceMedia(null);
  }

  async function handleImageFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file isn't an image. Try a JPEG or PNG.");
      return;
    }
    const prepared = await prepareLessonImage(file);
    if (pendingImage) URL.revokeObjectURL(pendingImage.url);
    setPendingImage({ file: prepared, url: URL.createObjectURL(prepared) });
  }

  function cancelPendingImage() {
    if (pendingImage) URL.revokeObjectURL(pendingImage.url);
    setPendingImage(null);
  }

  /**
   * Picture → "what do you want to know about it?" using the normal clarify
   * flow, so the answer plans a lesson on that part of the subject.
   */
  async function startImageTopic(identity: ImageIdentity, intro: string) {
    const subject = cleanTopicLabel(identity.subject);
    const opts =
      identity.focusOptions.length > 0
        ? identity.focusOptions
        : [`parts of the ${subject}`, `how the ${subject} works`];
    // Logged as the student's context so the lesson planner knows what they shared.
    pushMessage(
      "user",
      `I shared a picture of ${subject}. ${identity.description}`.trim(),
    );
    rememberOfferedFocus(subject, opts);
    setFocusOptions(opts);
    focusOptionsRef.current = opts;
    setPendingTopic(subject);
    pendingTopicRef.current = subject;
    lastParentRef.current = subject;
    setPhase("clarify_focus");
    if (!micOnRef.current) {
      const ok = await duplexRef.current?.acquireMic();
      if (ok) {
        setMicOn(true);
        micOnRef.current = true;
      }
    }
    const played = await speak(`${intro} ${casualFocusSay(subject, opts)}`);
    if (played && micOnRef.current) startListenLoopRef.current();
    else if (!micOnRef.current) setOrbState("idle");
  }

  async function chooseImageMode(mode: "image" | "model3d") {
    const pick = pendingImage;
    if (!pick) return;
    setPendingImage(null);
    if (phaseRef.current === "ended") newSession();

    // A new picture replaces whatever lesson was running.
    turnAbortRef.current?.abort();
    stopPlayback();
    clearLessonBoard();
    setPlan(null);
    planRef.current = null;
    cancelLessonVideo();
    setError(null);
    mediaAbortRef.current?.abort();
    const ac = new AbortController();
    mediaAbortRef.current = ac;
    replaceMedia(
      mode === "image"
        ? { kind: "image", imageUrl: pick.url }
        : { kind: "model3d", imageUrl: pick.url, progress: 0 },
    );

    setOrbState("thinking");
    try {
      if (mode === "image") {
        const identity = await identifyLessonImage(pick.file, ac.signal);
        if (ac.signal.aborted) return;
        setMedia((m) => (m ? { ...m, subject: identity.subject } : m));
        await startImageTopic(
          identity,
          `Got it — let's learn about the ${cleanTopicLabel(identity.subject)}.`,
        );
        return;
      }

      modelBuildingRef.current = true;
      void speak(
        "Nice picture. I'm turning it into a 3D model — give me a moment.",
        { allowBarge: false },
      );
      let identity: ImageIdentity;
      try {
        // Tripo first (best fidelity) when its key has credits…
        const taskId = await startModel3d(pick.file, ac.signal);
        await waitForModel3d(taskId, {
          signal: ac.signal,
          onProgress: (progress) =>
            setMedia((m) => (m?.kind === "model3d" ? { ...m, progress } : m)),
        });
        identity = await identifyLessonImage(pick.file, ac.signal);
        if (ac.signal.aborted) return;
        setMedia((m) =>
          m?.kind === "model3d"
            ? { ...m, subject: identity.subject, modelUrl: model3dFileUrl(taskId) }
            : m,
        );
      } catch (tripoErr) {
        if (ac.signal.aborted || (tripoErr as Error).name === "AbortError") return;
        // …otherwise the free path: the AI writes a Three.js model of it.
        setMedia((m) => (m?.kind === "model3d" ? { ...m, progress: undefined } : m));
        const three = await buildThreeModel(pick.file, ac.signal);
        if (ac.signal.aborted) return;
        identity = three;
        setMedia((m) =>
          m?.kind === "model3d"
            ? {
                ...m,
                subject: three.subject,
                scene: { title: three.title, brief: three.brief, code: three.code, attempt: 0 },
              }
            : m,
        );
      }
      modelBuildingRef.current = false;
      await startImageTopic(
        identity,
        `Your 3D model of the ${cleanTopicLabel(identity.subject)} is ready — drag it to spin it around.`,
      );
    } catch (err) {
      modelBuildingRef.current = false;
      if (ac.signal.aborted || (err as Error).name === "AbortError") return;
      const message = (err as Error).message || "Couldn't use that image.";
      if (mode === "model3d") {
        // 3D failed — keep going with the flat picture instead of dead-ending.
        setMedia((m) => (m?.kind === "model3d" ? { ...m, error: message } : m));
        try {
          const identity = await identifyLessonImage(pick.file, ac.signal);
          if (ac.signal.aborted) return;
          setMedia((m) => (m ? { ...m, subject: identity.subject } : m));
          await startImageTopic(
            identity,
            "I couldn't build the 3D model, so let's use your picture.",
          );
          return;
        } catch {
          /* fall through to the error below */
        }
      }
      setMedia((m) => (m?.kind === "image" ? { ...m, error: message } : m));
      setError(message);
      setOrbState("idle");
    }
  }

  /** Generated model crashed in the sandbox — ask the repair agent, max 3 tries. */
  async function repairSceneMedia(error: string) {
    const current = media;
    if (current?.kind !== "model3d" || !current.scene || current.error) return;
    if (sceneRepairingRef.current) return;
    const scene = current.scene;
    if (scene.attempt >= MAX_SCENE_REPAIR_ATTEMPTS) {
      setMedia((m) =>
        m?.kind === "model3d"
          ? { ...m, error: "The 3D model wouldn't render — here's your picture instead." }
          : m,
      );
      return;
    }
    const signal = mediaAbortRef.current?.signal;
    sceneRepairingRef.current = true;
    try {
      const code = await repairThreeModel({ ...scene, error, attempt: scene.attempt + 1 });
      if (signal?.aborted) return;
      setMedia((m) =>
        m?.kind === "model3d" && m.scene === scene
          ? { ...m, scene: { ...scene, code, attempt: scene.attempt + 1 } }
          : m,
      );
    } catch {
      if (signal?.aborted) return;
      setMedia((m) =>
        m?.kind === "model3d" && m.scene === scene
          ? { ...m, error: "The 3D model wouldn't render — here's your picture instead." }
          : m,
      );
    } finally {
      sceneRepairingRef.current = false;
    }
  }

  function endSession() {
    stopPlayback();
    stopListening();
    clearAsideConfirmTimer();
    clearBargeIdleResumeTimer();
    deferredQueriesRef.current = [];
    deferredQueueRef.current = [];
    deferredActiveRef.current = null;
    pendingAsideQuestionRef.current = null;
    skipCurrentBeatOnResumeRef.current = false;
    setMicOn(false);
    micOnRef.current = false;
    // Mute the engine too — otherwise its idle timer can reopen a hidden wake loop.
    duplexRef.current?.setStudentMuted(true);
    setPhase("ended");
    setOrbState("idle");
    persist({ ended: true });
  }

  function newSession() {
    stopPlayback();
    stopListening();
    clearAsideConfirmTimer();
    clearBargeIdleResumeTimer();
    deferredQueriesRef.current = [];
    deferredQueueRef.current = [];
    deferredActiveRef.current = null;
    pendingAsideQuestionRef.current = null;
    skipCurrentBeatOnResumeRef.current = false;
    checkHintCountRef.current = 0;
    checkRepeatCountRef.current = 0;
    bargeDoubtCountRef.current = 0;
    bargeLockedRef.current = false;
    lessonPausedRef.current = false;
    setLessonPaused(false);
    setBoardHaltWriting(false);
    clearLessonMedia();
    setSessionId(uid("vs"));
    setSessionLabel("New conversation");
    setMessages([]);
    messagesRef.current = [];
    setPlan(null);
    planRef.current = null;
    setBeatIndex(-1);
    cancelLessonVideo();
    setDraw(null);
    setBoard(null);
    setSections([]);
    setStanzas([]);
    setActiveStanzaIndex(0);
    setDrawings([]);
    setPendingTopic(null);
    pendingTopicRef.current = null;
    setFocusOptions([]);
    focusOptionsRef.current = [];
    topicCyclesRef.current = 0;
    lastParentRef.current = null;
    finalAttemptRef.current = false;
    checkHintCountRef.current = 0;
    setTopicCycles(0);
    setUserHeard("");
    setError(null);
    setMicOn(false);
    micOnRef.current = false;
    duplexRef.current?.setStudentMuted(true);
    setPhase("idle");
    setOrbState("idle");
  }

  function openHistory(id: string) {
    const found = getHistorySession(id);
    if (!found) return;
    stopPlayback();
    stopListening();
    setMicOn(false);
    micOnRef.current = false;
    duplexRef.current?.setStudentMuted(true);
    setSessionId(found.id);
    setSessionLabel(found.label);
    setMessages(found.messages);
    messagesRef.current = found.messages;
    setPhase(found.ended ? "ended" : "idle");
    setOrbState("idle");
    setPlan(null);
    cancelLessonVideo();
    setDraw(null);
    setBoard(null);
    setSections([]);
    setStanzas([]);
    setActiveStanzaIndex(0);
    setUserHeard("");
  }

  async function downloadPdf() {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      await exportVoiceSessionPdf({
        label: sessionLabel,
        topic: plan?.topic || pendingTopic || sessionLabel,
        objective: plan?.objective,
        messages,
        plan,
        drawings,
      });
    } catch (err) {
      setError(toUserFacingError(err, "Couldn't export the PDF."));
    } finally {
      setExportingPdf(false);
    }
  }

  const showPdf = phase === "ended" || messages.length > 2;

  return (
    <div
      className="fixed inset-0 flex bg-[#f4f4f6] font-[family-name:var(--font-geist)] text-[#16161a]"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOver(false);
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragOver(false);
        void handleImageFile(event.dataTransfer.files[0]);
      }}
    >
      {dragOver ? (
        <div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-[#16161a]/40 bg-white/70">
          <p className="text-[15px] font-medium text-[#16161a]">
            Drop a picture to learn about it
          </p>
        </div>
      ) : null}
      {pendingImage ? (
        <ImageChoiceDialog
          imageUrl={pendingImage.url}
          onChoose={(mode) => void chooseImageMode(mode)}
          onCancel={cancelPendingImage}
        />
      ) : null}
      {historyOpen ? (
        <div className="hidden h-full w-[min(18rem,34vw)] shrink-0 border-r border-[#ececee] bg-white md:block">
          <HistoryRail
            sessions={history}
            activeId={sessionId}
            onSelect={openHistory}
            onDelete={(id) => {
              deleteHistorySession(id);
              refreshHistory();
              if (id === sessionId) newSession();
            }}
            onNew={newSession}
          />
        </div>
      ) : null}

      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#f4f4f6]">
        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3">
          <div className="pointer-events-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("gap-1.5", INSPECT_CHIP)}
              onClick={() => setHistoryOpen((v) => !v)}
            >
              <PanelLeft className="size-3.5" />
              History
            </Button>
            <BrandMark
              compact
              size="sm"
              className="[&>span]:text-[#16161a]"
            />
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!showPdf || exportingPdf}
              aria-label="Export the session as PDF"
              aria-busy={exportingPdf}
              className={cn("gap-1.5 disabled:opacity-40", INSPECT_CHIP)}
              onClick={() => void downloadPdf()}
            >
              {exportingPdf ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileDown className="size-3.5" />
              )}
              PDF
            </Button>
            <StudyMenu
              current="smart-tutor"
              className="h-9 rounded-lg border border-[#ececee] bg-white px-3 text-[13px] font-medium text-[#16161a] hover:bg-[#fafafa] [&>span]:text-[#16161a]"
            />
          </div>
        </header>

        <main className="relative flex min-h-0 flex-1 flex-col bg-[#f4f4f6] pt-14">
          <LessonStage
            userHeard={userHeard}
            board={board}
            draw={draw}
            drawings={drawings}
            sections={sections}
            stanzas={stanzas}
            activeStanzaIndex={activeStanzaIndex}
            onStanzaComplete={onStanzaComplete}
            haltWriting={boardHaltWriting || lessonPaused}
            sources={plan?.sources}
            showText={formats.text}
            showDiagram={formats.diagram}
            preparing={preparingLesson}
            video={
              media || (videoJob && formats.video) ? (
                <>
                  {media ? (
                    <LessonMediaCard
                      media={media}
                      onClose={clearLessonMedia}
                      onSceneError={(message) => void repairSceneMedia(message)}
                    />
                  ) : null}
                  {videoJob && formats.video ? (
                    <div className={media ? "mt-6" : undefined}>
                      <LessonVideoPanel key={videoJob.topic} job={videoJob} />
                    </div>
                  ) : null}
                </>
              ) : undefined
            }
          />
          {error ? (
            <p className="absolute inset-x-0 top-16 mx-auto max-w-md rounded-lg border border-[#ececee] bg-white px-3 py-2 text-center text-[13px] text-[#c24545]">
              {error}
            </p>
          ) : null}
        </main>

        {/* Orb sits clearly above the input bar so it isn't clipped */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <VoiceOrb
            state={orbState}
            variant="dock"
            showLabel={false}
            className="pointer-events-none mb-4"
          />
          <div className="pointer-events-auto w-full max-w-md">
            <TeachFormatPicker
              value={formats}
              onChange={onFormatsChange}
              className="mb-2"
            />
            <div className="flex items-center justify-center gap-2 rounded-lg border border-[#ececee] bg-white px-2 py-1.5">
              <form
                className="min-w-0 flex-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = textFallback;
                  setTextFallback("");
                  void handleUserText(value);
                }}
              >
                <input
                  value={textFallback}
                  onChange={(event) => setTextFallback(event.target.value)}
                  placeholder={
                    phase === "ended"
                      ? "Lesson ended — tap the mic to start a new one"
                      : "Type if needed"
                  }
                  disabled={busy || phase === "ended"}
                  className="h-9 w-full bg-transparent px-2 text-[13px] text-[#16161a] outline-none placeholder:text-[#71717a] disabled:opacity-50"
                />
              </form>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void handleImageFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                aria-label="Add a picture to learn about"
                title="Add a picture (or drop one anywhere)"
                onClick={() => imageInputRef.current?.click()}
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#f4f4f6] text-[#16161a] transition hover:bg-[#ececee]"
              >
                <ImagePlus className="size-4" />
              </button>
              <button
                type="button"
                aria-label={micOn ? "Turn microphone off (pause)" : "Turn microphone on"}
                aria-pressed={micOn}
                onClick={() => void toggleMic()}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg transition",
                  micOn
                    ? "bg-[#16161a] text-white"
                    : "bg-[#f4f4f6] text-[#16161a] hover:bg-[#ececee]",
                )}
              >
                {micOn ? (
                  <Mic className="size-4" />
                ) : (
                  <MicOff className="size-4" />
                )}
              </button>
              <button
                type="button"
                aria-label={
                  lessonPaused
                    ? "Resume lesson"
                    : "Pause lesson — stop voice and writing"
                }
                title={
                  lessonPaused
                    ? "Resume lesson"
                    : "Pause (voice + transcript stop until you resume)"
                }
                onClick={togglePauseLesson}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg transition",
                  lessonPaused
                    ? "bg-[#16161a] text-white"
                    : "bg-[#f4f4f6] text-[#16161a] hover:bg-[#ececee]",
                )}
              >
                {lessonPaused ? (
                  <Play className="size-4" />
                ) : (
                  <Pause className="size-4" />
                )}
              </button>
              <button
                type="button"
                onClick={endSession}
                className="h-9 shrink-0 rounded-lg bg-[#16161a] px-3 text-[13px] font-medium text-white transition hover:bg-[#2a2a2e]"
              >
                End
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
