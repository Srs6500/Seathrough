"use client";

import { useEffect, useState } from "react";
import { BackendAsk } from "@/components/schema-guide/BackendAsk";
import { BackendFlow } from "@/components/schema-guide/BackendFlow";
import { guideBackend } from "@/lib/schema-guide/backendStory";
import { askBackend } from "@/lib/schema-guide/client";
import type {
  BackendAskResult,
  BackendFeature,
  SchemaGuide,
} from "@/lib/schema-guide/types";

type BackendView = "features" | "ask";

function FeatureCard({
  feature,
  onOpen,
}: {
  feature: BackendFeature;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full flex-col rounded-2xl border border-[#ececee] bg-white p-5 text-left shadow-[0_8px_24px_rgba(17,17,20,0.04)] hover:border-[#6d5efc]"
    >
      <p className="text-[12px] text-[#71717a]">{feature.when}</p>
      <h2 className="mt-1 text-[20px] font-medium tracking-[-0.03em] text-[#16161a]">
        {feature.title}
      </h2>
      <p className="mt-2 flex-1 text-[14px] leading-relaxed text-[#52525b]">
        {feature.summary}
      </p>
      <p className="mt-4 text-[12px] text-[#8a8a93]">
        {feature.steps.length} steps · Simulated
      </p>
    </button>
  );
}

export function BackendExplainer({
  guide,
  focusFeatureId,
  onOpenTable,
}: {
  guide: SchemaGuide;
  focusFeatureId?: string | null;
  onOpenTable: (tableId: string) => void;
}) {
  const backend = guideBackend(guide);
  const [view, setView] = useState<BackendView>("features");
  const [featureId, setFeatureId] = useState<string | null>(focusFeatureId ?? null);

  useEffect(() => {
    if (!focusFeatureId) return;
    setFeatureId(focusFeatureId);
    setView("features");
  }, [focusFeatureId]);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<BackendAskResult | null>(null);
  const [askQuestion, setAskQuestion] = useState<string | null>(null);
  const selected = backend.features.find((item) => item.id === featureId) ?? null;

  async function runAsk(question: string) {
    setAskBusy(true);
    setAskError(null);
    setAskQuestion(question);
    setAskResult(null);
    setView("ask");
    try {
      setAskResult(await askBackend(question, guide));
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Could not answer that.");
    } finally {
      setAskBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center border-b border-[#ececee] bg-white px-4">
        <nav className="flex items-center gap-1 rounded-full bg-[#f4f4f6] p-1">
          {(
            [
              ["features", "Features"],
              ["ask", "Ask"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setView(id);
                if (id === "features") setFeatureId(null);
              }}
              className={`rounded-full px-3 py-1 text-[13px] ${
                view === id ? "bg-white text-[#16161a] shadow-sm" : "text-[#71717a]"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "ask" ? (
          <BackendAsk
            guide={guide}
            asked={askQuestion}
            result={askResult}
            busy={askBusy}
            error={askError}
            onAsk={(question) => void runAsk(question)}
            onOpenFeature={(id) => {
              setFeatureId(id);
              setView("features");
            }}
            onOpenTable={onOpenTable}
          />
        ) : selected ? (
          <BackendFlow
            feature={selected}
            onBack={() => setFeatureId(null)}
            onOpenTable={onOpenTable}
          />
        ) : (
          <div className="h-full min-h-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-[880px] px-8 py-10">
              <p className="text-[12px] text-[#71717a]">Backend</p>
              <h1 className="mt-1 text-[28px] font-medium tracking-[-0.03em] text-[#16161a]">
                {backend.headline}
              </h1>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[#71717a]">
                {backend.blurb}
              </p>
              {backend.features.length === 0 ? (
                <p className="mt-10 text-[14px] text-[#71717a]">
                  We could not turn this schema into a request story yet.
                </p>
              ) : (
                <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                  {backend.features.map((feature) => (
                    <li key={feature.id}>
                      <FeatureCard
                        feature={feature}
                        onOpen={() => setFeatureId(feature.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
