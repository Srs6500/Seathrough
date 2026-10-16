"use client";

import {
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowUp,
  Check,
  Circle,
  Eraser,
  FileDown,
  LayoutGrid,
  LoaderCircle,
  Mic,
  Save,
  Square,
  Undo2,
} from "lucide-react";
import { ExperimentScript } from "@/components/experiment/ExperimentScript";
import { SystemDesignIntakeForm } from "@/components/experiment/SystemDesignIntakeForm";
import { BoxesLoader } from "@/components/ui/BoxesLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/AuthProvider";
import {
  playExperimentAudio,
  requestExperimentLesson,
  requestExperimentListen,
  requestExperimentReact,
  requestExperimentSpeak,
  requestSystemDesignRevision,
  setExperimentAudioTap,
  uploadSavedLessonVideo,
} from "@/lib/experiment/client";
import { changedSheets } from "@/lib/experiment/systemDesign/diff";
import {
  MAX_EDIT_HISTORY,
  type SystemDesignSpec,
} from "@/lib/experiment/systemDesign/spec";
import { gradeAnswer } from "@/lib/experiment/grade";
import type {
  ExperimentCheck,
  ExperimentLesson,
} from "@/lib/experiment/scene";
import { toUserFacingError } from "@/lib/errors/userFacing";
import type { ExperimentDrawSession } from "@/components/experiment/applyScene";
import { visibleLessonGraph } from "@/lib/experiment/graph";
import { fallbackLessonTitle } from "@/lib/experiment/lessonTitle";
import type { IntakeAnswers, SystemDesignIntake } from "@/lib/experiment/systemDesign/sections";
import {
  MAX_SAVED_MESSAGES,
  type DesignMessage,
  type SavedDesignSession,
} from "@/lib/experiment/systemDesign/session";
import {
  openDesignSession,
  saveDesignSession,
  type SavedDesignRef,
} from "@/lib/experiment/systemDesign/sessionClient";
import { saveLocalVideo } from "@/lib/experiment/localSavedVideos";
import {
  createLessonAudioTap,
  startScreenRecording,
  stopScreenRecording,
  type LessonAudioTap,
  type ScreenRecordSession,
} from "@/components/experiment/screenRecorder";

const ExperimentGraphPlot = dynamic(
  () =>
    import("@/components/experiment/ExperimentGraphPlot").then(
      (mod) => mod.ExperimentGraphPlot,
    ),
  { ssr: false },
);

const PLAN_PHRASES = [
  "Reading your question",
  "Writing the next step",
  "Drawing on the board",
] as const;

type Phase =
  | "idle"
  | "planning"
  | "playing"
  | "paused"
  | "reacting"
  | "intake"
  | "revising"
  | "opening";

type DesignState = {
  prompt: string;
  answers: IntakeAnswers;
  spec: SystemDesignSpec;
  /** Changes asked for so far; later edits are told about them so they are not undone. */
  edits: string[];
};

type DesignVersion = { spec: SystemDesignSpec; edits: string[] };

/** A design edit that has come back from the server and waits for a section boundary. */
type RevisionOutcome =
  | {
      kind: "revised";
      spec: SystemDesignSpec;
      edits: string[];
      lesson: ExperimentLesson;
      summary: string;
    }
  | { kind: "undo" }
  | { kind: "answer"; reply: string }
  | { kind: "new"; text: string }
  | { kind: "error"; message: string; text: string; messageId: string };

const UNDO_REQUEST = /^(undo|revert|go back)( (that|it|the last (change|edit)))?[.!]?$/i;

const PANEL_WIDTH_KEY = "seethrough-script-width";
const PANEL_MIN = 220;
const INTAKE_MIN = 320;

function panelMax() {
  return Math.max(PANEL_MIN, Math.min(760, Math.round(window.innerWidth * 0.6)));
}

function clampPanel(width: number, min = PANEL_MIN) {
  return Math.round(Math.min(panelMax(), Math.max(min, width)));
}

function fileName(title: string) {
  return `${title.replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "board"}.pdf`;
}

function isAbortError(caught: unknown) {
  return caught instanceof DOMException && caught.name === "AbortError";
}

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: {
    results: ArrayLike<ArrayLike<{ transcript: string }>>;
  }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/**
 * Full-viewport tldraw whiteboard plus a right-hand teaching script.
 */
export function ExperimentBoard({
  kind = "tutor",
  sessionId,
}: {
  kind?: "tutor" | "system" | "physics";
  /** A saved system design to reopen. */
  sessionId?: string;
} = {}) {
  const { accessToken, loading: authLoading } = useAuth();
  const [TldrawComp, setTldrawComp] = useState<
    typeof import("tldraw").Tldraw | null
  >(null);
  const editorRef = useRef<import("tldraw").Editor | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<ExperimentDrawSession | null>(null);
  const lessonRef = useRef<ExperimentLesson | null>(null);
  const indexRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const draftRef = useRef("");
  const captureRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<(ScreenRecordSession & { tap: LessonAudioTap }) | null>(
    null,
  );

  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [lesson, setLesson] = useState<ExperimentLesson | null>(null);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [pausedCheck, setPausedCheck] = useState<ExperimentCheck | null>(null);
  const [note, setNote] = useState("");
  const [voiceReady, setVoiceReady] = useState(false);
  const [browserStt, setBrowserStt] = useState(false);
  const [listening, setListening] = useState(false);
  const [topic, setTopic] = useState("");
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [intake, setIntake] = useState<SystemDesignIntake | null>(null);
  const [designPrompt, setDesignPrompt] = useState("");

  /** Latest design, including edits fetched but not yet on the board. Edits build on this. */
  const designRef = useRef<DesignState | null>(null);
  /** The design that matches what the board and script show right now. */
  const appliedRef = useRef<DesignVersion | null>(null);
  const historyRef = useRef<Array<DesignVersion & { lesson: ExperimentLesson }>>([]);
  const outcomesRef = useRef<RevisionOutcome[]>([]);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  /** Edits sent and not yet applied. */
  const queuedRef = useRef(0);
  /** Edits whose request has not come back. */
  const inflightRef = useRef(0);
  const playingRef = useRef(false);
  const flushingRef = useRef(false);
  /** Bumped when the design is thrown away, so late responses are ignored. */
  const epochRef = useRef(0);
  const reviseAbortRef = useRef<AbortController | null>(null);
  const [hasDesign, setHasDesign] = useState(false);
  const [queuedEdits, setQueuedEdits] = useState(0);
  const [canUndo, setCanUndo] = useState(false);

  /** What the student asked and what the tutor answered, shown between the beats. */
  const [messages, setMessages] = useState<DesignMessage[]>([]);
  const messagesRef = useRef<DesignMessage[]>([]);
  /** Where this design was last saved; saving again overwrites it. */
  const savedRef = useRef<SavedDesignRef | null>(null);
  /** The `?session=` id this page has already tried to open, so it opens once. */
  const openedRef = useRef<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [savingDesign, setSavingDesign] = useState(false);
  /** "saved" once the board matches the last save; any later change makes it "changed". */
  const [saveState, setSaveState] = useState<"new" | "saved" | "changed">("new");
  const [exporting, setExporting] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);

  const busy =
    phase === "planning" ||
    phase === "playing" ||
    phase === "reacting" ||
    phase === "revising" ||
    phase === "opening" ||
    saving;
  const designEditable =
    kind === "system" &&
    hasDesign &&
    !saving &&
    (phase === "idle" || phase === "playing" || phase === "revising");
  const boardWaiting =
    !TldrawComp || phase === "planning" || phase === "reacting" || phase === "opening";
  const canDictate = voiceReady || browserStt;
  phaseRef.current = phase;
  draftRef.current = draft;

  useEffect(() => {
    let alive = true;
    void (async () => {
      await import("tldraw/tldraw.css");
      const mod = await import("tldraw");
      if (alive) setTldrawComp(() => mod.Tldraw);
    })();
    void fetch("/api/health")
      .then((res) => res.json())
      .then((body: { services?: { deepgram?: boolean } }) => {
        if (alive) setVoiceReady(Boolean(body.services?.deepgram));
      })
      .catch(() => {
        if (alive) setVoiceReady(false);
      });
    setBrowserStt(
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    );
    return () => {
      alive = false;
      abortRef.current?.abort();
      reviseAbortRef.current?.abort();
      epochRef.current += 1;
      stopMic();
      const rec = screenRef.current;
      screenRef.current = null;
      setExperimentAudioTap(null);
      rec?.stream.getTracks().forEach((track) => track.stop());
      if (rec && rec.recorder.state !== "inactive") {
        try {
          rec.recorder.stop();
        } catch {
          /* unmounting */
        }
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== "planning" && phase !== "reacting") return;
    let i = 0;
    setStatus(PLAN_PHRASES[0]);
    const timer = window.setInterval(() => {
      i = (i + 1) % PLAN_PHRASES.length;
      setStatus(PLAN_PHRASES[i]!);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (kind !== "system" || !sessionId || !editorReady || authLoading) return;
    if (openedRef.current === sessionId) return;
    openedRef.current = sessionId;
    void openSaved(sessionId);
    // openSaved reads refs and the current token; it must run once per id, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sessionId, editorReady, authLoading]);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (!Number.isFinite(stored) || stored <= 0) return;
    const width = clampPanel(stored);
    const frame = window.requestAnimationFrame(() => setPanelWidth(width));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const min = intake ? INTAKE_MIN : PANEL_MIN;
    const onResize = () =>
      setPanelWidth((width) => (width === null ? null : clampPanel(width, min)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [intake]);

  useEffect(() => {
    if (!intake) return;
    setPanelWidth((width) => clampPanel(width ?? INTAKE_MIN, INTAKE_MIN));
  }, [intake]);

  function storePanelWidth(width: number | null) {
    try {
      if (width === null) window.localStorage.removeItem(PANEL_WIDTH_KEY);
      else window.localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      /* private mode: the width lasts for this visit */
    }
  }

  function onResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      width: panelRef.current?.getBoundingClientRect().width ?? PANEL_MIN,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function panelMin() {
    return intake ? INTAKE_MIN : PANEL_MIN;
  }

  function onResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setPanelWidth(clampPanel(drag.width + drag.x - event.clientX, panelMin()));
  }

  function onResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    const width = panelRef.current?.getBoundingClientRect().width;
    if (width) storePanelWidth(Math.round(width));
  }

  function onResizeKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16;
    const min = panelMin();
    const current = panelRef.current?.getBoundingClientRect().width ?? min;
    let next: number | null;
    if (event.key === "ArrowLeft") next = clampPanel(current + step, min);
    else if (event.key === "ArrowRight") next = clampPanel(current - step, min);
    else if (event.key === "Home") next = clampPanel(min, min);
    else if (event.key === "End") next = panelMax();
    else return;
    event.preventDefault();
    event.stopPropagation();
    setPanelWidth(next);
    storePanelWidth(next);
  }

  function stopMic() {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null;
    setListening(false);
  }

  const messageSeqRef = useRef(0);

  function setConversation(next: DesignMessage[]) {
    messagesRef.current = next.slice(-MAX_SAVED_MESSAGES);
    setMessages(messagesRef.current);
  }

  function markChanged() {
    setSaveState((current) => (current === "saved" ? "changed" : current));
  }

  /** Adds a line to the script after the beat on screen now; returns its id. */
  function addMessage(role: DesignMessage["role"], text: string): string {
    messageSeqRef.current += 1;
    const message: DesignMessage = {
      id: `m${Date.now().toString(36)}${messageSeqRef.current}`,
      role,
      text: text.trim(),
      afterBeat: lessonRef.current ? indexRef.current : -1,
    };
    setConversation([...messagesRef.current, message]);
    markChanged();
    return message.id;
  }

  function markFailed(id: string) {
    setConversation(
      messagesRef.current.map((message) =>
        message.id === id ? { ...message, failed: true } : message,
      ),
    );
  }

  function setSessionParam(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("session", id);
    else url.searchParams.delete("session");
    window.history.replaceState(window.history.state, "", url);
  }

  /** The board no longer shows the saved design, so the next save starts a new entry. */
  function forgetSaved() {
    savedRef.current = null;
    openedRef.current = null;
    setSaveState("new");
    if (kind === "system") setSessionParam(null);
  }

  function resetDesign() {
    epochRef.current += 1;
    reviseAbortRef.current?.abort();
    reviseAbortRef.current = null;
    designRef.current = null;
    appliedRef.current = null;
    historyRef.current = [];
    outcomesRef.current = [];
    chainRef.current = Promise.resolve();
    queuedRef.current = 0;
    inflightRef.current = 0;
    flushingRef.current = false;
    setHasDesign(false);
    setQueuedEdits(0);
    setCanUndo(false);
  }

  function clearBoard() {
    abortRef.current?.abort();
    abortRef.current = null;
    resetDesign();
    stopMic();
    const editor = editorRef.current;
    if (editor) {
      try {
        const ids = [...editor.getCurrentPageShapeIds()];
        if (ids.length) editor.deleteShapes(ids);
      } catch {
        /* board may already be empty */
      }
    }
    sessionRef.current = null;
    lessonRef.current = null;
    indexRef.current = 0;
    setLesson(null);
    setCurrentBeat(-1);
    setPausedCheck(null);
    setNote("");
    setError("");
    setStatus("");
    setPhase("idle");
    setTopic("");
    setDraft("");
    setIntake(null);
    setDesignPrompt("");
    setConversation([]);
    forgetSaved();
  }

  function onPromptKey(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
  }

  async function speakLine(text: string, signal: AbortSignal) {
    if (!voiceReady || !text.trim()) return;
    try {
      const spoken = await requestExperimentSpeak(
        text,
        signal,
        kind === "physics" ? "physics" : "tutor",
      );
      if (!spoken || signal.aborted) return;
      await playExperimentAudio(spoken, signal);
    } catch {
      /* script is still visible */
    }
  }

  async function playFrom(start: number, ac: AbortController) {
    const editor = editorRef.current;
    const session = sessionRef.current;
    if (!editor || !lessonRef.current || !session) return;

    const { playExperimentBeat } = await import(
      "@/components/experiment/applyScene"
    );

    playingRef.current = true;
    try {
      // The lesson is re-read every beat: a design edit can replace it between sections.
      for (
        let index = start;
        index < (lessonRef.current?.beats.length ?? 0);
        index += 1
      ) {
        if (ac.signal.aborted) return;
        const beat = lessonRef.current!.beats[index]!;
        indexRef.current = index;
        setCurrentBeat(index);
        setPhase("playing");
        const lookOnly = /^look at the board\.?$/i.test(beat.say.trim());
        const speech = lookOnly
          ? Promise.resolve()
          : speakLine(beat.say, ac.signal);
        await playExperimentBeat(editor, beat, session);
        await speech;
        if (ac.signal.aborted) return;
        if (queuedRef.current > 0) {
          if (inflightRef.current > 0) {
            setStatus("Applying your change");
            await chainRef.current;
          }
          if (ac.signal.aborted) return;
          const next = await flushRevisions(true);
          setStatus("");
          if (next === "stop") return;
        }
        if (beat.check) {
          setPausedCheck(beat.check);
          setPhase("paused");
          setStatus("");
          const ask = beat.check.ask.trim();
          const alreadySaid =
            ask.localeCompare(beat.say.trim(), undefined, {
              sensitivity: "accent",
            }) === 0;
          if (!alreadySaid) await speakLine(ask, ac.signal);
          return;
        }
      }
    } finally {
      playingRef.current = false;
    }
    setPausedCheck(null);
    setPhase("idle");
    setStatus("");
    setCurrentBeat(Math.max(0, (lessonRef.current?.beats.length ?? 1) - 1));
    if (outcomesRef.current.length) void flushRevisions();
  }

  function speechSignal(): AbortSignal {
    if (!abortRef.current || abortRef.current.signal.aborted) {
      abortRef.current = new AbortController();
    }
    return abortRef.current.signal;
  }

  function settleQueued(count = 1) {
    queuedRef.current = Math.max(0, queuedRef.current - count);
    setQueuedEdits(queuedRef.current);
  }

  /**
   * Sends an edit right away, in order behind any earlier edit, so each one
   * builds on the last. It reaches the board at the next section boundary,
   * or at once when nothing is playing.
   */
  function queueRevision(instruction: string, messageId: string) {
    const design = designRef.current;
    if (!design) return;
    const epoch = epochRef.current;
    if (!reviseAbortRef.current || reviseAbortRef.current.signal.aborted) {
      reviseAbortRef.current = new AbortController();
    }
    const signal = reviseAbortRef.current.signal;
    queuedRef.current += 1;
    inflightRef.current += 1;
    setQueuedEdits(queuedRef.current);
    setDraft("");
    setError("");

    chainRef.current = chainRef.current
      .then(async () => {
        if (epoch !== epochRef.current) return;
        const base = designRef.current;
        if (!base) return;
        let outcome: RevisionOutcome;
        try {
          const revision = await requestSystemDesignRevision(
            { ...base, instruction },
            signal,
          );
          if (revision.kind === "revised") {
            const edits = [...base.edits, instruction].slice(-MAX_EDIT_HISTORY);
            designRef.current = { ...base, spec: revision.spec, edits };
            outcome = {
              kind: "revised",
              spec: revision.spec,
              edits,
              lesson: revision.lesson,
              summary: revision.summary,
            };
          } else if (revision.kind === "answer") {
            outcome = { kind: "answer", reply: revision.reply };
          } else {
            outcome = { kind: "new", text: instruction };
          }
        } catch (caught) {
          if (signal.aborted || isAbortError(caught)) return;
          outcome = {
            kind: "error",
            message: toUserFacingError(
              caught,
              "Could not change the design. Try again.",
            ),
            text: instruction,
            messageId,
          };
        }
        if (epoch !== epochRef.current) return;
        outcomesRef.current.push(outcome);
      })
      .catch(() => undefined)
      .finally(() => {
        if (epoch !== epochRef.current) return;
        inflightRef.current = Math.max(0, inflightRef.current - 1);
        if (!playingRef.current) void flushRevisions();
      });
  }

  function undoChange() {
    const last = historyRef.current[historyRef.current.length - 1];
    if (!last || queuedRef.current > 0 || !designRef.current) return;
    designRef.current = { ...designRef.current, spec: last.spec, edits: last.edits };
    queuedRef.current += 1;
    setQueuedEdits(queuedRef.current);
    setCanUndo(false);
    outcomesRef.current.push({ kind: "undo" });
    if (!playingRef.current) void flushRevisions();
  }

  /**
   * Puts finished edits on the board in the order they were sent. Only sheets
   * already drawn are redrawn; later sheets simply play from the new design.
   * Returns "stop" when playback should end (a new design was asked for).
   */
  async function flushRevisions(inPlayback = false): Promise<"ok" | "stop"> {
    if (flushingRef.current) return "ok";
    const editor = editorRef.current;
    const session = sessionRef.current;
    const epoch = epochRef.current;
    flushingRef.current = true;
    let enteredRevising = false;
    try {
      while (outcomesRef.current.length) {
        if (epoch !== epochRef.current) return "stop";
        const outcome = outcomesRef.current.shift()!;
        settleQueued();
        if (outcome.kind === "error") {
          setError(outcome.message);
          markFailed(outcome.messageId);
          if (!draftRef.current.trim()) setDraft(outcome.text);
          continue;
        }
        if (outcome.kind === "new") {
          outcomesRef.current = [];
          enteredRevising = false;
          flushingRef.current = false;
          void startLesson(outcome.text);
          return "stop";
        }
        if (!inPlayback && !enteredRevising) {
          enteredRevising = true;
          setPhase("revising");
        }
        if (outcome.kind === "answer") {
          addMessage("tutor", outcome.reply);
          await speakLine(outcome.reply, speechSignal());
          continue;
        }
        const current = lessonRef.current;
        const applied = appliedRef.current;
        if (!editor || !session || !current || !applied) continue;

        let target: DesignVersion & { lesson: ExperimentLesson };
        let summary: string;
        if (outcome.kind === "undo") {
          const last = historyRef.current.pop();
          if (!last) continue;
          target = last;
          summary = "Undid the last change.";
        } else {
          historyRef.current.push({ ...applied, lesson: current });
          target = { spec: outcome.spec, edits: outcome.edits, lesson: outcome.lesson };
          summary = outcome.summary;
        }

        const { redrawExperimentSheets } = await import(
          "@/components/experiment/applyScene"
        );
        const diff = changedSheets(current, target.lesson);
        await redrawExperimentSheets(
          editor,
          session,
          current,
          target.lesson,
          diff.shapes,
        );
        if (epoch !== epochRef.current) return "stop";
        lessonRef.current = target.lesson;
        appliedRef.current = { spec: target.spec, edits: target.edits };
        setLesson(target.lesson);
        setCanUndo(historyRef.current.length > 0);
        addMessage("tutor", summary);
        await speakLine(summary, speechSignal());
      }
    } finally {
      if (epoch === epochRef.current) {
        flushingRef.current = false;
        if (enteredRevising) setPhase("idle");
      }
    }
    return "ok";
  }

  async function onPromptSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (designEditable) {
      requestDesignChange(text);
      return;
    }
    if (busy) return;
    if (phase === "paused") {
      await submitAnswer(text);
      return;
    }
    await startLesson(text);
  }

  function requestDesignChange(text: string) {
    if (UNDO_REQUEST.test(text)) {
      setDraft("");
      if (!historyRef.current.length) {
        setError("There is no change to undo.");
        return;
      }
      if (queuedRef.current > 0) {
        setError("Wait for your last change to land, then undo.");
        return;
      }
      addMessage("user", text);
      undoChange();
      return;
    }
    queueRevision(text, addMessage("user", text));
  }

  async function startLesson(text: string) {
    const editor = editorRef.current;
    if (!editor) {
      setError("The board is still loading. Try again in a moment.");
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    stopMic();
    resetDesign();

    setPhase("planning");
    setError("");
    setDraft("");
    setLesson(null);
    lessonRef.current = null;
    setCurrentBeat(-1);
    setPausedCheck(null);
    setNote("");
    setTopic(text);
    setIntake(null);
    setDesignPrompt("");
    forgetSaved();
    setConversation([]);
    const promptId = addMessage("user", text);

    try {
      const result = await requestExperimentLesson(text, ac.signal, undefined, kind);
      if (ac.signal.aborted) return;
      if (result.kind === "intake") {
        setIntake(result.intake);
        setDesignPrompt(text);
        setPhase("intake");
        setStatus("");
        return;
      }
      const next = result.lesson;
      lessonRef.current = next;
      setLesson(next);
      const { prepareExperimentSession } = await import(
        "@/components/experiment/applyScene"
      );
      sessionRef.current = prepareExperimentSession(editor, next);
      await playFrom(0, ac);
    } catch (caught) {
      if (
        ac.signal.aborted ||
        (caught instanceof DOMException && caught.name === "AbortError")
      ) {
        return;
      }
      markFailed(promptId);
      setDraft(text);
      setPhase("idle");
      setError(
        toUserFacingError(
          caught,
          "Could not explain that. Try another question.",
        ),
      );
    }
  }

  async function submitDesign(answers: IntakeAnswers) {
    const editor = editorRef.current;
    const prompt = designPrompt.trim();
    if (!editor || !prompt) return;
    if (Object.values(answers).some((value) => !value.trim())) {
      setError("Answer all four questions.");
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("planning");
    setError("");
    setStatus("Designing the system");

    try {
      const result = await requestExperimentLesson(prompt, ac.signal, answers, kind);
      if (ac.signal.aborted) return;
      if (result.kind !== "lesson") {
        throw new Error("Could not design that system. Try again.");
      }
      setIntake(null);
      resetDesign();
      if (result.spec) {
        designRef.current = { prompt, answers, spec: result.spec, edits: [] };
        appliedRef.current = { spec: result.spec, edits: [] };
        setHasDesign(true);
      }
      addMessage("user", Object.values(answers).map((value) => value.trim()).join("\n"));
      lessonRef.current = result.lesson;
      setLesson(result.lesson);
      const { prepareExperimentSession } = await import(
        "@/components/experiment/applyScene"
      );
      sessionRef.current = prepareExperimentSession(editor, result.lesson);
      await playFrom(0, ac);
    } catch (caught) {
      if (
        ac.signal.aborted ||
        (caught instanceof DOMException && caught.name === "AbortError")
      ) {
        return;
      }
      setPhase("intake");
      setError(
        toUserFacingError(caught, "Could not design that system. Try again."),
      );
    }
  }

  async function submitAnswer(answer: string) {
    const check = pausedCheck;
    const current = lessonRef.current;
    const ac = abortRef.current;
    if (!check || !current || !ac || busy) return;
    const text = answer.trim();
    if (!text) {
      setError("An answer is required.");
      return;
    }

    setError("");
    setDraft("");
    setPhase("reacting");
    setStatus("Checking your answer");
    const ask = check.ask.trim();
    const beatSay = current.beats[indexRef.current]?.say.trim() ?? "";
    if (ask && ask.localeCompare(beatSay, undefined, { sensitivity: "accent" }) !== 0) {
      addMessage("tutor", ask);
    }
    const answerId = addMessage("user", text);
    setPausedCheck(null);

    try {
      const local = gradeAnswer(text, check.expect);
      const followup =
        local === "continue"
          ? {
              verdict: "continue" as const,
              say: "That's it. Let's keep going.",
              lesson: { title: current.title, beats: [] },
            }
          : await requestExperimentReact(
              {
                topic,
                title: current.title,
                ask: check.ask,
                expect: check.expect,
                answer: text,
                lastSay: current.beats[indexRef.current]?.say ?? "",
                ...(kind === "physics" ? { mode: "physics" as const } : {}),
              },
              ac.signal,
            );

      if (ac.signal.aborted) return;
      addMessage("tutor", followup.say);
      await speakLine(followup.say, ac.signal);

      if (followup.lesson.beats.length) {
        const merged: ExperimentLesson = {
          ...current,
          beats: [
            ...current.beats.slice(0, indexRef.current + 1),
            ...followup.lesson.beats,
            ...current.beats.slice(indexRef.current + 1),
          ],
        };
        lessonRef.current = merged;
        setLesson(merged);
      }

      await playFrom(indexRef.current + 1, ac);
    } catch (caught) {
      if (
        ac.signal.aborted ||
        (caught instanceof DOMException && caught.name === "AbortError")
      ) {
        return;
      }
      markFailed(answerId);
      setPausedCheck(check);
      setPhase("paused");
      setDraft(text);
      setError(
        toUserFacingError(
          caught,
          "Could not explain that. Try another question.",
        ),
      );
    }
  }

  async function skipCheck() {
    if (phase !== "paused" || !abortRef.current) return;
    setPausedCheck(null);
    setNote("We'll keep going.");
    await playFrom(indexRef.current + 1, abortRef.current);
  }

  function boardTitle() {
    return (
      appliedRef.current?.spec.title ||
      lessonRef.current?.title ||
      topic.trim() ||
      "Board"
    );
  }

  async function saveDesign() {
    const editor = editorRef.current;
    const design = designRef.current;
    const applied = appliedRef.current;
    if (!editor || !design || !applied || savingDesign) return;
    if (queuedRef.current > 0) {
      setError("Wait for your change to land, then save.");
      return;
    }
    setSavingDesign(true);
    setError("");
    try {
      const session: SavedDesignSession = {
        version: 1,
        prompt: design.prompt,
        answers: design.answers,
        spec: applied.spec,
        edits: applied.edits,
        messages: messagesRef.current,
      };
      const { boardPreview } = await import("@/components/experiment/boardExport");
      const preview = await boardPreview(editor, sessionRef.current);
      const outcome = await saveDesignSession({
        ref: savedRef.current,
        title: boardTitle(),
        session,
        preview,
        accessToken,
      });
      savedRef.current = outcome.ref;
      setSessionParam(outcome.ref.id);
      setSaveState("saved");
      if (outcome.cloudError) console.warn("[design-save] kept on this device:", outcome.cloudError);
      setNote(
        !outcome.ref.local
          ? "Saved. Open it from Dashboard to keep building."
          : accessToken
            ? "Saved on this device; your account could not be reached. Save again later to move it there."
            : "Saved on this device. Sign in to keep it in your account.",
      );
    } catch (caught) {
      setError(toUserFacingError(caught, "Could not save this design. Try again."));
    } finally {
      setSavingDesign(false);
    }
  }

  async function exportPdf() {
    const editor = editorRef.current;
    if (!editor || exporting) return;
    if (!editor.getCurrentPageShapeIds().size) {
      setError("There is nothing on the board to export yet.");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const { downloadBlob, exportBoardPdf } = await import("@/components/experiment/boardExport");
      const title = boardTitle();
      const pdf = await exportBoardPdf(editor, sessionRef.current, lessonRef.current, title);
      downloadBlob(pdf, fileName(title));
    } catch (caught) {
      setError(toUserFacingError(caught, "Could not export the board. Try again."));
    } finally {
      setExporting(false);
    }
  }

  /** Puts a saved design back on the board, ready for more changes. */
  async function openSaved(id: string) {
    const editor = editorRef.current;
    if (!editor) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    stopMic();
    resetDesign();
    setPhase("opening");
    setStatus("Opening your design");
    setError("");
    setNote("");
    setIntake(null);
    setPausedCheck(null);
    setLesson(null);
    lessonRef.current = null;
    setCurrentBeat(-1);
    setConversation([]);
    try {
      const opened = await openDesignSession(id, accessToken, ac.signal);
      if (ac.signal.aborted) return;
      const { prompt, answers, spec, edits } = opened.session;
      const { drawExperimentLessonNow } = await import("@/components/experiment/applyScene");
      const session = await drawExperimentLessonNow(editor, opened.lesson);
      if (ac.signal.aborted) return;
      designRef.current = { prompt, answers, spec, edits };
      appliedRef.current = { spec, edits };
      sessionRef.current = session;
      lessonRef.current = opened.lesson;
      const last = opened.lesson.beats.length - 1;
      indexRef.current = last;
      setLesson(opened.lesson);
      setCurrentBeat(last);
      setTopic(prompt);
      setHasDesign(true);
      setConversation(opened.session.messages);
      savedRef.current = opened.ref;
      setSaveState("saved");
      setNote("Ask for a change to keep building on this design.");
      setPhase("idle");
      setStatus("");
    } catch (caught) {
      if (ac.signal.aborted || isAbortError(caught)) return;
      setSessionParam(null);
      setPhase("idle");
      setStatus("");
      setError(toUserFacingError(caught, "Could not open that design."));
    }
  }

  async function persistRecording(file: {
    blob: Blob;
    mimeType: string;
    durationMs: number;
    poster?: Blob;
  }) {
    const current = lessonRef.current ?? {
      title: topic.trim() || "Screen recording",
      ...(topic.trim() ? { question: topic.trim() } : {}),
      beats: [{ say: "Recorded from Smart tutor.", shapes: [] }],
    };
    if (accessToken) {
      try {
        await uploadSavedLessonVideo({
          video: file.blob,
          poster: file.poster,
          lesson: current,
          durationMs: file.durationMs,
          accessToken,
        });
        setNote("Saved. Open Dashboard to watch it.");
        return;
      } catch {
        /* keep a local copy */
      }
    }
    await saveLocalVideo({
      title: fallbackLessonTitle(current),
      titleSource: "lesson",
      question: current.question,
      durationMs: file.durationMs,
      mimeType: file.mimeType,
      video: file.blob,
      poster: file.poster,
    });
    setNote(
      accessToken
        ? "Saved on this device. Sign in to keep it saved to your account."
        : "Saved on this device. Open Dashboard to watch it.",
    );
  }

  async function stopRecording() {
    const session = screenRef.current;
    if (!session) {
      setRecording(false);
      setExperimentAudioTap(null);
      return;
    }
    screenRef.current = null;
    setRecording(false);
    setSaving(true);
    try {
      const file = await stopScreenRecording(session);
      await persistRecording(file);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(
          toUserFacingError(caught, "Could not save that recording. Try again."),
        );
      }
    } finally {
      setExperimentAudioTap(null);
      void session.tap.context.close().catch(() => undefined);
      setSaving(false);
    }
  }

  async function startRecording() {
    if (recording || saving || screenRef.current) return;
    setError("");
    try {
      const tap = createLessonAudioTap();
      await tap.context.resume().catch(() => undefined);
      setExperimentAudioTap(tap);
      const session = await startScreenRecording(tap);
      screenRef.current = { ...session, tap };
      setRecording(true);
      setNote("Recording. Click Stop when the lesson is done.");
      const video = session.stream.getVideoTracks()[0];
      video?.addEventListener("ended", () => {
        if (screenRef.current) void stopRecording();
      });
    } catch (caught) {
      setExperimentAudioTap(null);
      const name = caught instanceof DOMException ? caught.name : "";
      if (name === "NotAllowedError") {
        setError("Recording was cancelled. Click Record and share this tab.");
        return;
      }
      setError(
        toUserFacingError(
          caught,
          "Could not start recording. Click Record and share this tab.",
        ),
      );
    }
  }

  async function applyTranscript(transcript: string) {
    const text = transcript.trim();
    if (!text) {
      setError("Couldn't hear that. Try again.");
      return;
    }
    setDraft(text);
    const current = phaseRef.current;
    if (
      kind === "system" &&
      designRef.current &&
      (current === "idle" || current === "playing" || current === "revising")
    ) {
      requestDesignChange(text);
      return;
    }
    if (current === "paused") {
      await submitAnswer(text);
      return;
    }
    if (current === "idle") {
      await startLesson(text);
    }
  }

  function startBrowserDictation() {
    const SpeechCtor = (window as Window & {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    }).SpeechRecognition ??
      (window as Window & {
        webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
      }).webkitSpeechRecognition;
    if (!SpeechCtor) {
      setError("Voice is not available in this browser.");
      return;
    }
    const recognition = new SpeechCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i]?.[0]?.transcript ?? "";
      }
      setDraft(text);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setListening(false);
      setError("Couldn't hear that. Try again.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      const text = draftRef.current.trim();
      if (text) void applyTranscript(text);
    };
    recognition.start();
    setListening(true);
    setError("");
  }

  async function toggleMic() {
    if (!canDictate || (busy && !designEditable)) return;
    if (listening) {
      stopMic();
      return;
    }
    if (!voiceReady) {
      startBrowserDictation();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setListening(false);
        if (!blob.size) return;
        void (async () => {
          try {
            const transcript = await requestExperimentListen(
              blob,
              abortRef.current?.signal,
            );
            await applyTranscript(transcript);
          } catch (caught) {
            setError(
              toUserFacingError(caught, "Couldn't hear that. Try again."),
            );
          }
        })();
      };
      recorder.start();
      setListening(true);
      setError("");
      window.setTimeout(() => {
        if (recorderRef.current === recorder && recorder.state === "recording") {
          recorder.stop();
        }
      }, 10000);
    } catch {
      setError("Could not start the microphone. Try again.");
    }
  }

  const Tldraw = TldrawComp;
  const placeholder = listening
    ? "Listening…"
    : phase === "paused"
      ? "Type or speak your answer…"
      : designEditable
        ? "Change the design, like “use AWS instead of Supabase”…"
      : kind === "system"
        ? "Describe a system, like a chat app or a URL shortener…"
        : kind === "physics"
          ? "Ask a physics question, like electric fields or capacitors…"
          : "Ask a question or tap the mic…";
  const graph =
    lesson && currentBeat >= 0
      ? visibleLessonGraph(lesson.beats, currentBeat)
      : null;
  const editNotice =
    queuedEdits > 0
      ? phase === "playing"
        ? queuedEdits > 1
          ? `${queuedEdits} changes will apply after this section.`
          : "Your change will apply after this section."
        : "Updating the design…"
      : "";
  const inputLocked = busy && !designEditable;

  return (
    <div className="experiment-board fixed inset-0 flex bg-board">
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={captureRef}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {graph ? (
            <div className="relative z-10 h-[min(42vh,360px)] shrink-0 px-4 pt-12 pb-2">
              <ExperimentGraphPlot graph={graph} />
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            {Tldraw ? (
              <Tldraw
                hideUi
                persistenceKey={
                  kind === "system"
                    ? "seethrough-system-design"
                    : kind === "physics"
                      ? "seethrough-physics-tutor"
                      : "seethrough-experiment"
                }
                onMount={(editor) => {
                  editorRef.current = editor;
                  editor.selectNone();
                  editor.setCurrentTool("hand");
                  setEditorReady(true);
                }}
              />
            ) : null}
            {saving ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/55">
                <BoxesLoader label="Saving recording" />
              </div>
            ) : boardWaiting ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <BoxesLoader
                  label={
                    !Tldraw
                      ? "Loading whiteboard"
                      : status || "Drawing on the board"
                  }
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-none absolute top-3 left-3 z-30 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearBoard}
            className="pointer-events-auto h-8 gap-1.5 rounded-none border-board-edge bg-white/95 px-2.5 text-[13px] text-ink shadow-[0_8px_20px_rgba(26,43,60,0.08)] backdrop-blur-sm"
          >
            <Eraser className="size-3.5" />
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (recording) void stopRecording();
              else void startRecording();
            }}
            disabled={saving}
            aria-pressed={recording}
            aria-label={recording ? "Stop recording" : "Start recording"}
            className="pointer-events-auto h-8 gap-1.5 rounded-none border-board-edge bg-white/95 px-2.5 text-[13px] text-ink shadow-[0_8px_20px_rgba(26,43,60,0.08)] backdrop-blur-sm disabled:opacity-50"
          >
            {recording ? (
              <>
                <span className="record-dot" aria-hidden />
                Stop
              </>
            ) : (
              <>
                <Circle className="size-3.5 fill-[#c24545] text-[#c24545]" />
                Record
              </>
            )}
          </Button>
          {kind === "system" && hasDesign ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={undoChange}
              disabled={!canUndo || queuedEdits > 0 || saving}
              aria-label="Undo the last design change"
              className="pointer-events-auto h-8 gap-1.5 rounded-none border-board-edge bg-white/95 px-2.5 text-[13px] text-ink shadow-[0_8px_20px_rgba(26,43,60,0.08)] backdrop-blur-sm disabled:opacity-50"
            >
              <Undo2 className="size-3.5" />
              Undo
            </Button>
          ) : null}
        </div>
        <div className="pointer-events-none absolute top-3 right-3 z-30 flex gap-2">
          {kind === "system" && hasDesign ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void saveDesign()}
              disabled={
                savingDesign ||
                queuedEdits > 0 ||
                phase === "opening" ||
                phase === "planning"
              }
              aria-label={
                saveState === "saved"
                  ? "Design saved"
                  : saveState === "changed"
                    ? "Save changes to this design"
                    : "Save this design"
              }
              className="pointer-events-auto h-8 gap-1.5 rounded-none border-board-edge bg-white/95 px-2.5 text-[13px] text-ink shadow-[0_8px_20px_rgba(26,43,60,0.08)] backdrop-blur-sm disabled:opacity-50"
            >
              {savingDesign ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : saveState === "saved" ? (
                <Check className="size-3.5" />
              ) : (
                <Save className="size-3.5" />
              )}
              {savingDesign ? "Saving" : saveState === "saved" ? "Saved" : "Save"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void exportPdf()}
            disabled={exporting || !lesson}
            aria-label="Export the board as PDF"
            className="pointer-events-auto h-8 gap-1.5 rounded-none border-board-edge bg-white/95 px-2.5 text-[13px] text-ink shadow-[0_8px_20px_rgba(26,43,60,0.08)] backdrop-blur-sm disabled:opacity-50"
          >
            {exporting ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <FileDown className="size-3.5" />
            )}
            {exporting ? "Exporting" : "PDF"}
          </Button>
          <Button
            asChild
            type="button"
            variant="outline"
            size="sm"
            className="pointer-events-auto h-8 gap-1.5 rounded-none border-board-edge bg-white/95 px-2.5 text-[13px] text-ink shadow-[0_8px_20px_rgba(26,43,60,0.08)] backdrop-blur-sm"
          >
            <Link href={kind === "system" ? "/dashboard?tab=designs" : "/dashboard"}>
              <LayoutGrid className="size-3.5" />
              Dashboard
            </Link>
          </Button>
        </div>

        <form
          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(event) => void onPromptSubmit(event)}
          onKeyDown={onPromptKey}
          onKeyUp={onPromptKey}
        >
          <div className="pointer-events-auto w-full max-w-[34rem]">
            {error ? (
              <p
                className="mb-2 rounded-none bg-white/90 px-3 py-2 text-center text-[13px] text-error shadow-[0_8px_20px_rgba(26,43,60,0.08)]"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {editNotice ? (
              <p className="mb-2 text-center text-[12px] text-muted" role="status">
                {editNotice}
              </p>
            ) : busy && status && !boardWaiting ? (
              <p className="mb-2 text-center text-[12px] text-muted">
                {status}
              </p>
            ) : null}
            {phase === "paused" ? (
              <div className="mb-2 flex justify-center">
                <button
                  type="button"
                  className="text-[12px] text-muted underline-offset-2 hover:underline"
                  onClick={() => void skipCheck()}
                >
                  Skip this check
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-2 rounded-none border border-board-edge bg-white/95 p-1.5 shadow-[0_12px_32px_rgba(26,43,60,0.12)] backdrop-blur-sm">
              <label htmlFor="experiment-prompt" className="sr-only">
                {phase === "paused" ? "Answer" : "Question"}
              </label>
              {canDictate && !inputLocked ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant={listening ? "default" : "ghost"}
                  aria-label={
                    listening
                      ? "Stop listening"
                      : phase === "paused"
                        ? "Answer with voice"
                        : "Ask with voice"
                  }
                  aria-pressed={listening}
                  onClick={() => void toggleMic()}
                  className="size-9 rounded-none"
                >
                  {listening ? (
                    <Square className="size-3.5" />
                  ) : (
                    <Mic className="size-4" />
                  )}
                </Button>
              ) : null}
              <Input
                id="experiment-prompt"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={placeholder}
                autoComplete="off"
                disabled={inputLocked}
                maxLength={designEditable ? 500 : 800}
                className="h-10 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-[15px] shadow-none focus-visible:ring-0"
              />
              <Button
                type="submit"
                size="icon-sm"
                disabled={inputLocked || !draft.trim()}
                aria-label={
                  inputLocked
                    ? "Explaining"
                    : designEditable
                      ? "Change the design"
                      : phase === "paused"
                        ? "Submit answer"
                        : "Send"
                }
                className="size-9 rounded-none bg-[#085080] text-white hover:bg-[#083068]"
              >
                {inputLocked ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>

      <div
        ref={panelRef}
        className={`relative h-full min-w-[13.75rem] shrink-0 ${
          panelWidth ? "" : "w-[min(22rem,36vw)]"
        }`}
        style={panelWidth ? { width: panelWidth } : undefined}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the script"
          aria-valuemin={intake ? INTAKE_MIN : PANEL_MIN}
          aria-valuemax={760}
          aria-valuenow={panelWidth ?? 352}
          tabIndex={0}
          className="absolute inset-y-0 -left-1 z-40 w-2 cursor-col-resize touch-none outline-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-board-edge hover:before:bg-[#085080] focus-visible:before:bg-[#085080]"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onKeyDown={onResizeKey}
        />
        {intake && phase === "intake" ? (
          <SystemDesignIntakeForm
            intake={intake}
            prompt={designPrompt}
            busy={false}
            error={error}
            onSubmit={(answers) => void submitDesign(answers)}
          />
        ) : (
          <ExperimentScript
            lesson={lesson}
            currentBeat={currentBeat}
            streaming={phase === "playing" || phase === "planning"}
            pausedCheck={pausedCheck}
            note={note}
            messages={messages}
            intro={
              kind === "system"
                ? "Describe a system. Four short questions come first, then the design is drawn on the board. Ask for a change at any point, like a different provider or a new feature, and every diagram follows."
                : kind === "physics"
                  ? "Ask a high-school physics question. The tutor teaches in short steps, draws field diagrams on the board, and checks you understood — same Smart tutor flow."
                  : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
