"use client";

import { useState } from "react";
import { guideBackend } from "@/lib/schema-guide/backendStory";
import { humanLabel } from "@/lib/schema-guide/overviewStory";
import type {
  BackendAskResult,
  BackendFeature,
  SchemaGuide,
} from "@/lib/schema-guide/types";

export function BackendAsk({
  guide,
  asked,
  result,
  busy,
  error,
  onAsk,
  onOpenFeature,
  onOpenTable,
}: {
  guide: SchemaGuide;
  asked: string | null;
  result: BackendAskResult | null;
  busy: boolean;
  error: string | null;
  onAsk: (question: string) => void;
  onOpenFeature: (featureId: string) => void;
  onOpenTable: (tableId: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const backend = guideBackend(guide);
  const chips = backend.features.slice(0, 4);
  const matched = result?.featureId
    ? backend.features.find((item) => item.id === result.featureId)
    : null;

  function submit(next: string) {
    const text = next.trim();
    if (!text || busy) return;
    setQuestion("");
    onAsk(text);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col px-8 py-10">
          {!result && !busy ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#16161a]">
                Ask what happens
              </h1>
              <p className="mt-2 max-w-sm text-[15px] text-[#71717a]">
                We will walk one feature as a sample request — not the whole backend.
              </p>
              <ul className="mt-8 flex w-full flex-wrap justify-center gap-2">
                {chips.map((feature) => (
                  <li key={feature.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit(chipQuestion(feature))}
                      className="rounded-full border border-[#e6e6ea] bg-white px-3 py-1.5 text-[13px] text-[#16161a] hover:border-[#6d5efc]"
                    >
                      {chipQuestion(feature)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <article>
              {asked ? (
                <header className="mb-8">
                  <p className="text-[12px] text-[#71717a]">You asked</p>
                  <h1 className="mt-2 text-[24px] font-medium leading-snug tracking-[-0.03em] text-[#16161a]">
                    {asked}
                  </h1>
                </header>
              ) : null}
              {busy && !result ? (
                <p className="text-[15px] text-[#71717a]">
                  Walking the matching feature…
                </p>
              ) : null}
              {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
              {result ? (
                <>
                  <p className="text-[12px] text-[#71717a]">In everyday words</p>
                  <p className="mt-2 text-[18px] font-medium leading-relaxed tracking-[-0.02em] text-[#16161a]">
                    {result.answer}
                  </p>
                  {matched ? (
                    <button
                      type="button"
                      onClick={() => onOpenFeature(matched.id)}
                      className="mt-4 rounded-full bg-[#6d5efc] px-4 py-2 text-[13px] text-white"
                    >
                      Watch {matched.title}
                    </button>
                  ) : null}

                  {result.walkthrough.length ? (
                    <section className="mt-8">
                      <h2 className="text-[15px] font-medium text-[#16161a]">
                        What happens
                      </h2>
                      <ol className="mt-3 space-y-3">
                        {result.walkthrough.map((step) => (
                          <li
                            key={step.step}
                            className="flex gap-3 rounded-2xl border border-[#ececee] bg-white px-4 py-3"
                          >
                            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#f4f1ff] text-[12px] text-[#5b4fd4]">
                              {step.step}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[15px] leading-relaxed text-[#16161a]">
                                {step.text}
                              </p>
                              {step.tableId ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenTable(step.tableId!)}
                                  className="mt-2 text-[13px] text-[#6d5efc]"
                                >
                                  See {humanLabel(step.tableId)}
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                </>
              ) : null}
            </article>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-linear-to-t from-[#f4f4f6] via-[#f4f4f6] to-transparent px-4 pb-5 pt-2">
        <form
          className="mx-auto flex w-full max-w-[640px] items-end gap-2 rounded-[28px] border border-[#e6e6ea] bg-white px-3 py-2 shadow-[0_8px_24px_rgba(17,17,20,0.06)]"
          onSubmit={(event) => {
            event.preventDefault();
            submit(question);
          }}
        >
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask what happens when someone uses a feature"
            className="min-h-11 flex-1 bg-transparent px-2 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="h-9 shrink-0 rounded-full bg-[#6d5efc] px-4 text-sm text-white disabled:opacity-40"
          >
            {busy ? "…" : "Ask"}
          </button>
        </form>
      </div>
    </div>
  );
}

function chipQuestion(feature: BackendFeature): string {
  const when = feature.when.replace(/^When /i, "when ");
  return `What happens ${when}?`;
}
