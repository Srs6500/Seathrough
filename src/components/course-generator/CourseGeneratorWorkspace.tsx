"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { CourseShelf } from "@/components/course-generator/CourseShelf";
import { IntakeCard } from "@/components/course-generator/IntakeCard";
import { UnitViewer } from "@/components/course-generator/UnitViewer";
import { SiteHeader } from "@/components/site/SiteHeader";
import { StudioAccessProvider } from "@/components/site/StudioAccess";
import {
  requestCourseIntake,
  requestCourseOutline,
  requestGenerateCourseUnit,
} from "@/lib/course-generator/client";
import {
  deleteSavedCourse,
  loadSavedCourses,
  saveCourse,
} from "@/lib/course-generator/store";
import type {
  CourseOutline,
  IntakeAnswer,
  IntakeQuestion,
} from "@/lib/course-generator/types";
import { toUserFacingError } from "@/lib/errors/userFacing";

type Stage = "prompt" | "intake" | "shelf" | "unit";

export function CourseGeneratorWorkspace() {
  const [stage, setStage] = useState<Stage>("prompt");
  const [topic, setTopic] = useState("");
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  const [course, setCourse] = useState<CourseOutline | null>(null);
  const [activeUnitId, setActiveUnitId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [saved, setSaved] = useState<CourseOutline[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("course-generator-page");
    setSaved(loadSavedCourses());
    return () => {
      document.documentElement.classList.remove("course-generator-page");
      abortRef.current?.abort();
    };
  }, []);

  function resetToPrompt() {
    abortRef.current?.abort();
    setStage("prompt");
    setQuestions([]);
    setCourse(null);
    setActiveUnitId(null);
    setGeneratingId(null);
    setError(null);
    setBusy(false);
  }

  async function startIntake() {
    const trimmed = topic.trim();
    if (!trimmed) {
      setError("Enter what you want to learn");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const qs = await requestCourseIntake(trimmed, ac.signal);
      setQuestions(qs);
      setStage("intake");
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(toUserFacingError(err, "Couldn't start the intake."));
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }

  async function buildOutline(answers: IntakeAnswer[]) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const next = await requestCourseOutline({
        topic: topic.trim(),
        answers,
        signal: ac.signal,
      });
      setCourse(next);
      saveCourse(next);
      setSaved(loadSavedCourses());
      setStage("shelf");
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(toUserFacingError(err, "Couldn't build the course."));
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }

  async function openUnit(unitId: string) {
    if (!course) return;
    const unit = course.units.find((u) => u.id === unitId);
    if (!unit) return;

    if (unit.status === "ready" && unit.content) {
      setActiveUnitId(unitId);
      setStage("unit");
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setGeneratingId(unitId);
    setError(null);
    setCourse((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        updatedAt: Date.now(),
        units: prev.units.map((u) =>
          u.id === unitId
            ? { ...u, status: "generating", error: undefined }
            : u,
        ),
      };
    });
    setActiveUnitId(unitId);
    setStage("unit");

    try {
      const latest = course;
      const { content, summary } = await requestGenerateCourseUnit({
        course: {
          ...latest,
          units: latest.units.map((u) =>
            u.id === unitId
              ? { ...u, status: "generating", error: undefined }
              : u,
          ),
        },
        unitId,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setCourse((prev) => {
        if (!prev) return prev;
        const next: CourseOutline = {
          ...prev,
          updatedAt: Date.now(),
          units: prev.units.map((u) =>
            u.id === unitId
              ? {
                  ...u,
                  status: "ready",
                  content,
                  summary,
                  error: undefined,
                }
              : u,
          ),
        };
        saveCourse(next);
        setSaved(loadSavedCourses());
        return next;
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      const message = toUserFacingError(err, "Couldn't generate that unit.");
      setError(message);
      setCourse((prev) => {
        if (!prev) return prev;
        const next: CourseOutline = {
          ...prev,
          updatedAt: Date.now(),
          units: prev.units.map((u) =>
            u.id === unitId
              ? { ...u, status: "error", error: message }
              : u,
          ),
        };
        saveCourse(next);
        return next;
      });
      setStage("shelf");
      setActiveUnitId(null);
    } finally {
      if (!ac.signal.aborted) setGeneratingId(null);
    }
  }

  const activeUnit =
    course && activeUnitId
      ? course.units.find((u) => u.id === activeUnitId)
      : null;

  return (
    <StudioAccessProvider>
    <div className="flex min-h-dvh flex-col bg-[#f4f4f6] font-[family-name:var(--font-geist)] text-[#16161a]">
      <SiteHeader />
      <main className="flex min-h-0 flex-1 flex-col">
        {stage === "unit" && activeUnit ? (
          <UnitViewer
            unit={activeUnit}
            onBack={() => {
              setStage("shelf");
              setActiveUnitId(null);
            }}
          />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
            {stage === "prompt" ? (
              <div className="mx-auto w-full max-w-xl">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-[#1b6ca8] uppercase">
                  Course generator
                </p>
                <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
                  What do you want to learn?
                </h1>
                <p className="mt-2 text-[14px] leading-6 text-[#71717a]">
                  Describe the topic. We&apos;ll ask a few questions, build an
                  outline, then generate each whiteboard lesson, notes page, and
                  practice set when you open it — later units use earlier ones.
                </p>
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={4}
                  placeholder="e.g. Explain recursion for a beginner who knows basic Python loops"
                  className="mt-5 w-full resize-none rounded-xl border border-[#e4e4e7] bg-white px-4 py-3 text-[14px] outline-none focus:border-[#1b6ca8] focus:ring-2 focus:ring-[#1b6ca8]/15"
                  disabled={busy}
                />
                {error ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-lg border border-[#f3d4d4] bg-[#fdf3f3] px-3 py-2 text-[13px] text-[#c24545]"
                  >
                    {error}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={busy || !topic.trim()}
                  onClick={() => void startIntake()}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#16161a] text-[14px] font-medium text-white transition hover:bg-[#2a2a2e] disabled:opacity-40"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {busy ? "Preparing questions…" : "Continue"}
                </button>

                {saved.length > 0 ? (
                  <div className="mt-8">
                    <p className="text-[12px] font-semibold tracking-wide text-[#71717a] uppercase">
                      Saved courses
                    </p>
                    <ul className="mt-2 space-y-2">
                      {saved.map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center gap-2 rounded-xl border border-[#ececee] bg-white p-3"
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              setCourse(c);
                              setTopic(c.topic);
                              setStage("shelf");
                              setError(null);
                            }}
                          >
                            <span className="block truncate text-[14px] font-semibold">
                              {c.title}
                            </span>
                            <span className="block truncate text-[12px] text-[#71717a]">
                              {c.units.length} units ·{" "}
                              {c.units.filter((u) => u.status === "ready").length}{" "}
                              ready
                            </span>
                          </button>
                          <button
                            type="button"
                            className="text-[12px] text-[#a1a1aa] hover:text-[#c24545]"
                            onClick={() => {
                              deleteSavedCourse(c.id);
                              setSaved(loadSavedCourses());
                              if (course?.id === c.id) resetToPrompt();
                            }}
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {stage === "intake" ? (
              <>
                {error ? (
                  <p
                    role="alert"
                    className="mb-4 rounded-lg border border-[#f3d4d4] bg-[#fdf3f3] px-3 py-2 text-[13px] text-[#c24545]"
                  >
                    {error}
                  </p>
                ) : null}
                <IntakeCard
                  topic={topic.trim()}
                  questions={questions}
                  busy={busy}
                  onBack={resetToPrompt}
                  onSubmit={(answers) => void buildOutline(answers)}
                />
              </>
            ) : null}

            {stage === "shelf" && course ? (
              <>
                {error ? (
                  <p
                    role="alert"
                    className="mb-4 rounded-lg border border-[#f3d4d4] bg-[#fdf3f3] px-3 py-2 text-[13px] text-[#c24545]"
                  >
                    {error}
                  </p>
                ) : null}
                <CourseShelf
                  course={course}
                  generatingId={generatingId}
                  onOpenUnit={(id) => void openUnit(id)}
                  onNew={resetToPrompt}
                />
              </>
            ) : null}
          </div>
        )}
      </main>
    </div>
    </StudioAccessProvider>
  );
}
