"use client";

import { useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/lms/AccountMenu";
import { AppHeader } from "@/components/lms/AppHeader";
import { AppShell } from "@/components/lms/AppShell";
import { BoardScene } from "@/components/ai-tutor-v2/BoardScene";
import { Button } from "@/components/ui/button";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import {
  applyBoardAction,
  createLesson,
  emptyBoard,
  isBoardAction,
  openLessonEvents,
  submitInteraction,
  type BoardNodes,
  type LearnerLevel,
  type TranscriptBeat,
} from "@/lib/ai-tutor-v2";

type Phase = "idle" | "streaming" | "ready" | "error";

export function AiTutorV2Workspace() {
  const { openAuth } = useQuestionAccess();
  const [question, setQuestion] = useState("Why do seasons happen?");
  const [followUp, setFollowUp] = useState("");
  const [level, setLevel] = useState<LearnerLevel>("beginner");
  const [includeExample, setIncludeExample] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState(
    "Ask a question to start a streamed whiteboard lesson.",
  );
  const [error, setError] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [nodes, setNodes] = useState<BoardNodes>(emptyBoard());
  const [pointedId, setPointedId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptBeat[]>([]);
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null);
  const closerRef = useRef<(() => void) | null>(null);
  const pointTimerRef = useRef<number | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      closerRef.current?.();
      if (pointTimerRef.current) window.clearTimeout(pointTimerRef.current);
    };
  }, []);

  function clearPointTimer() {
    if (pointTimerRef.current) {
      window.clearTimeout(pointTimerRef.current);
      pointTimerRef.current = null;
    }
  }

  function attachStream(nextLessonId: string, fromSeq?: number) {
    closerRef.current?.();
    setPhase("streaming");
    setStatus("Streaming lesson events…");
    closerRef.current = openLessonEvents(
      nextLessonId,
      {
      onEvent: (name, data) => {
        if (typeof data.seq === "number") {
          lastSeqRef.current = Math.max(lastSeqRef.current, data.seq);
        }
        if (name === "lesson.plan") {
          const payload = data.payload as { title?: string; mode?: string };
          if (payload.title) setTitle(payload.title);
          if (payload.mode) setMode(payload.mode);
          setStatus(`Planning ${payload.title ?? "lesson"}…`);
          return;
        }
        if (name === "beat.started") {
          const payload = data.payload as { objective?: string };
          setCurrentBeatId(data.beat_id);
          setTranscript((prev) => [
            ...prev,
            {
              beat_id: data.beat_id,
              objective: payload.objective ?? "",
              narration: "",
            },
          ]);
          setStatus(payload.objective || "Next beat…");
          return;
        }
        if (name === "narration.text") {
          const text = String(
            (data.payload as { text?: string }).text ?? "",
          );
          setTranscript((prev) => {
            const copy = [...prev];
            const index = copy.findLastIndex(
              (item) => item.beat_id === data.beat_id,
            );
            if (index >= 0) copy[index] = { ...copy[index], narration: text };
            else {
              copy.push({
                beat_id: data.beat_id,
                objective: "",
                narration: text,
              });
            }
            return copy;
          });
          setStatus(text || "Narrating…");
          return;
        }
        if (name === "board.action") {
          const action = data.payload;
          if (!isBoardAction(action)) return;
          if (action.type === "point") {
            setPointedId(action.target_id);
            clearPointTimer();
            pointTimerRef.current = window.setTimeout(() => {
              setPointedId(null);
            }, action.emphasis_ms ?? 800);
            return;
          }
          setNodes((prev) => applyBoardAction(prev, action));
          return;
        }
        if (name === "lesson.completed") {
          setPhase("ready");
          setStatus("Lesson complete. Ask a follow-up or start over.");
          return;
        }
        if (name === "lesson.error") {
          setPhase("error");
          setError(
            String(
              (data.payload as { message?: string }).message ??
                "The lesson could not be generated.",
            ),
          );
          setStatus("Lesson failed.");
          return;
        }
        if (name === "lesson.cancelled") {
          setPhase("ready");
          setStatus("Previous version cancelled. Continuing with the new one.");
        }
      },
      onError: (message) => {
        setPhase("error");
        setError(message);
        setStatus("Stream interrupted.");
      },
      },
      fromSeq != null ? { lastEventId: fromSeq } : undefined,
    );
  }

  async function startLesson() {
    const trimmed = question.trim();
    if (!trimmed) {
      setError("Enter a question first.");
      return;
    }
    closerRef.current?.();
    clearPointTimer();
    setError(null);
    setNodes(emptyBoard());
    setPointedId(null);
    setTranscript([]);
    setTitle(null);
    setMode(null);
    setCurrentBeatId(null);
    lastSeqRef.current = 0;
    setPhase("streaming");
    setStatus("Creating lesson…");
    try {
      const created = await createLesson({
        question: trimmed,
        level,
        includeExample,
      });
      setLessonId(created.lesson_id);
      setVersionId(created.version_id);
      attachStream(created.lesson_id, 0);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Could not create lesson.");
      setStatus("Could not start the lesson.");
    }
  }

  async function askFollowUp() {
    if (!lessonId || !versionId) return;
    const trimmed = followUp.trim();
    if (!trimmed) {
      setError("Enter a follow-up question.");
      return;
    }
    setError(null);
    setPhase("streaming");
    setStatus("Sending follow-up…");
    try {
      const created = await submitInteraction({
        lessonId,
        kind: "question",
        text: trimmed,
        currentVersionId: versionId,
        currentBeatId,
      });
      setVersionId(created.version_id);
      setFollowUp("");
      attachStream(lessonId, lastSeqRef.current);
    } catch (err) {
      setPhase("error");
      setError(
        err instanceof Error ? err.message : "Could not send the follow-up.",
      );
      setStatus("Follow-up failed.");
    }
  }

  async function startOver() {
    if (!lessonId) {
      await startLesson();
      return;
    }
    setError(null);
    setPhase("streaming");
    setStatus("Starting over…");
    setNodes(emptyBoard());
    setPointedId(null);
    setTranscript([]);
    try {
      const created = await submitInteraction({
        lessonId,
        kind: "start_over",
        currentVersionId: versionId ?? undefined,
      });
      setVersionId(created.version_id);
      attachStream(lessonId, lastSeqRef.current);
    } catch (err) {
      setPhase("error");
      setError(
        err instanceof Error ? err.message : "Could not start the lesson over.",
      );
    }
  }

  const busy = phase === "streaming";

  return (
    <AppShell>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader
          current="ai-tutor-v2"
          eyebrow="Lab"
          title="AI Tutor v2"
          account={
            <AccountMenu
              onLogin={() => openAuth("login")}
              onSignup={() => openAuth("signup")}
            />
          }
        />

        <main className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)] md:p-4">
          <section className="flex min-h-0 flex-col gap-3">
            <form
              className="rounded-xl border border-[#d7e3eb] bg-white p-3 shadow-sm"
              onSubmit={(event) => {
                event.preventDefault();
                void startLesson();
              }}
            >
              <label className="block text-sm font-medium text-[#17324a]">
                Question
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={2}
                  className="mt-1.5 w-full resize-none rounded-lg border border-[#d7e3eb] bg-[#f8fbff] px-3 py-2 text-sm outline-none ring-[#93c5fd] focus:ring-2"
                  placeholder="Why do seasons happen?"
                  disabled={busy}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted">
                  Level
                  <select
                    value={level}
                    onChange={(event) =>
                      setLevel(event.target.value as LearnerLevel)
                    }
                    className="rounded-md border border-[#d7e3eb] bg-white px-2 py-1 text-xs text-[#17324a]"
                    disabled={busy}
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={includeExample}
                    onChange={(event) =>
                      setIncludeExample(event.target.checked)
                    }
                    disabled={busy}
                  />
                  Include example
                </label>
                <div className="ml-auto flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || !lessonId}
                    onClick={() => void startOver()}
                  >
                    Start over
                  </Button>
                  <Button type="submit" size="sm" disabled={busy}>
                    {busy ? "Streaming…" : "Ask"}
                  </Button>
                </div>
              </div>
            </form>

            <div className="min-h-0 flex-1">
              <BoardScene nodes={nodes} pointedId={pointedId} />
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-3">
            <div className="rounded-xl border border-[#d7e3eb] bg-white p-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Status
              </p>
              <p className="mt-1 text-sm text-[#17324a]">{status}</p>
              {title ? (
                <p className="mt-2 text-xs text-muted">
                  {title}
                  {mode ? ` · ${mode}` : ""}
                  {lessonId ? ` · ${lessonId}` : ""}
                </p>
              ) : null}
              {error ? (
                <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[#d7e3eb] bg-white p-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Transcript
              </p>
              {transcript.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  Narration beats will appear here as the stream arrives.
                </p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {transcript.map((beat, index) => (
                    <li
                      key={`${beat.beat_id ?? "beat"}-${index}`}
                      className="rounded-lg border border-[#e8eef4] bg-[#f8fbff] p-2.5"
                    >
                      <p className="text-xs font-semibold text-[#17324a]">
                        {beat.objective || beat.beat_id || `Beat ${index + 1}`}
                      </p>
                      {beat.narration ? (
                        <p className="mt-1 text-sm leading-relaxed text-[#334155]">
                          {beat.narration}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <form
              className="rounded-xl border border-[#d7e3eb] bg-white p-3 shadow-sm"
              onSubmit={(event) => {
                event.preventDefault();
                void askFollowUp();
              }}
            >
              <label className="block text-sm font-medium text-[#17324a]">
                Follow-up
                <input
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#d7e3eb] bg-[#f8fbff] px-3 py-2 text-sm outline-none ring-[#93c5fd] focus:ring-2"
                  placeholder="Does Earth being closer to the Sun cause summer?"
                  disabled={busy || !lessonId}
                />
              </label>
              <div className="mt-2 flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy || !lessonId || !followUp.trim()}
                >
                  Ask follow-up
                </Button>
              </div>
            </form>
          </aside>
        </main>
      </div>
    </AppShell>
  );
}
