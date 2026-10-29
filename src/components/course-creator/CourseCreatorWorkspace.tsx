"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AccountMenu } from "@/components/lms/AccountMenu";
import { AppHeader } from "@/components/lms/AppHeader";
import { AppShell } from "@/components/lms/AppShell";
import { Button } from "@/components/ui/button";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import { requestLessonScript } from "@/lib/course-creator/client";
import {
  formatRuntime,
  PROMPT_MAX,
  type LessonScript,
} from "@/lib/course-creator/script";
import { toUserFacingError } from "@/lib/errors/userFacing";

const EXAMPLE = "How HTTPS keeps a password private, for people who browse the web";

export function CourseCreatorWorkspace() {
  const { beginQuestion, cancelQuestion, openAuth } = useQuestionAccess();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState<LessonScript | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function writeScript(from?: string) {
    const next = (from ?? prompt).trim();
    if (!next) {
      setError("Enter what this lesson should teach.");
      return;
    }
    if (!beginQuestion()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    if (from) setPrompt(next);
    try {
      const result = await requestLessonScript(next, controller.signal);
      setScript(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      cancelQuestion();
      setError(
        toUserFacingError(
          err,
          "The script could not be written. Try again in a moment.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void writeScript();
  }

  return (
    <AppShell>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f4f7fb]">
        <AppHeader
          current="course-creator"
          title="Course creator"
          account={
            <AccountMenu
              onLogin={() => openAuth("login")}
              onSignup={() => openAuth("signup")}
            />
          }
        />

        {!script ? (
          <main className="flex min-h-0 flex-1 items-center justify-center px-5 py-12">
            <form onSubmit={onSubmit} className="w-full max-w-xl">
              <h1 className="font-display text-[2.4rem] leading-[1.15] tracking-[-0.02em] text-[#17324a]">
                Write the lesson
              </h1>
              <p className="mt-3 max-w-md text-[16px] leading-7 text-[#5a7388]">
                Describe what people should walk away knowing. You get a
                shooting script: voice, picture, and the words on screen.
              </p>
              <label className="mt-10 block">
                <span className="sr-only">Lesson prompt</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={PROMPT_MAX}
                  rows={3}
                  placeholder="A 6-minute lesson on…"
                  disabled={busy}
                  className="w-full resize-none border-0 border-b border-[#17324a] bg-transparent px-0 py-3 text-[18px] leading-8 text-[#17324a] outline-none placeholder:text-[#9aadc0] focus-visible:border-[#1b6ca8] disabled:opacity-60"
                />
              </label>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Writing the script…
                    </>
                  ) : (
                    "Write script"
                  )}
                </Button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void writeScript(EXAMPLE)}
                  className="text-sm font-medium text-[#2a5f7a] hover:underline disabled:opacity-50"
                >
                  Try HTTPS
                </button>
              </div>
              {error ? (
                <p className="mt-4 text-sm text-red-700" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
          </main>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <form
              onSubmit={onSubmit}
              className="flex shrink-0 flex-wrap items-end gap-3 border-b border-[#d7e3eb] bg-white px-4 py-3 md:px-6"
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Lesson prompt</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={PROMPT_MAX}
                  rows={2}
                  disabled={busy}
                  className="w-full resize-none rounded-md border border-[#d7e3eb] bg-[#f8fafc] px-3 py-2 text-sm leading-6 text-[#17324a] outline-none focus-visible:border-[#1b6ca8] disabled:opacity-60"
                />
              </label>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Writing…
                  </>
                ) : (
                  "Rewrite"
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  abortRef.current?.abort();
                  setScript(null);
                  setError(null);
                }}
              >
                New lesson
              </Button>
            </form>
            {error ? (
              <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
                {error}
              </p>
            ) : null}
            <main className="min-h-0 flex-1 overflow-y-auto">
              <article className="mx-auto max-w-2xl px-5 py-10 md:py-14">
                <p className="text-sm text-[#6a7d90]">
                  {script.audience}
                  <span className="text-[#c5d0da]"> · </span>
                  {formatRuntime(script.runtimeSeconds)}
                  <span className="text-[#c5d0da]"> · </span>
                  {script.beats.length} beats
                </p>
                <h1 className="mt-3 font-display text-[2.15rem] leading-[1.2] tracking-[-0.02em] text-[#17324a]">
                  {script.title}
                </h1>
                <p className="mt-4 max-w-prose text-[17px] leading-8 text-[#3d5368]">
                  {script.hook}
                </p>
                <ol className="mt-12 space-y-10">
                  {script.beats.map((beat, index) => (
                    <li
                      key={`${beat.heading}-${index}`}
                      className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 border-t border-[#e5eef4] pt-6"
                    >
                      <span className="font-display text-[1.35rem] tabular-nums text-[#9aadc0]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#17324a]">
                          {beat.heading}
                        </h2>
                        <dl className="mt-4 space-y-3">
                          <div>
                            <dt className="font-mono text-[11px] text-[#7a93a8]">
                              Visual
                            </dt>
                            <dd className="mt-0.5 text-[15px] leading-7 text-[#3d5368]">
                              {beat.visual}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-mono text-[11px] text-[#7a93a8]">
                              Voice
                            </dt>
                            <dd className="mt-0.5 text-[16px] leading-7 text-[#17324a]">
                              {beat.voiceover}
                            </dd>
                          </div>
                          {beat.onScreen ? (
                            <div>
                              <dt className="font-mono text-[11px] text-[#7a93a8]">
                                On screen
                              </dt>
                              <dd className="mt-0.5 font-medium text-[15px] text-[#1b6ca8]">
                                {beat.onScreen}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                    </li>
                  ))}
                </ol>
              </article>
            </main>
          </div>
        )}
      </div>
    </AppShell>
  );
}
