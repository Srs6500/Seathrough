"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleHelp,
  CreditCard,
  LayoutGrid,
  Loader2,
  Lock,
  RefreshCw,
  ScanSearch,
  Settings,
  Users,
} from "lucide-react";
import {
  getCachedFrontendArchScan,
  runFrontendArchScan,
} from "@/lib/frontend-arch/client";
import type { DataIndex } from "@/lib/bug-analyzer/buildDataIndex";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { askXRayFeature } from "@/lib/xray/client";
import {
  buildXRay,
  nodeBeginnerBlurb,
} from "@/lib/xray/buildXRay";
import type {
  XRayFeature,
  XRayFeatureKind,
  XRayFeatureStatus,
  XRayNode,
} from "@/lib/xray/types";

export type XRayExploreTarget = {
  tab: "frontend" | "backend";
  findingId?: string;
  pagePath?: string;
};

type Props = {
  accessToken: string | null;
  onNeedAuth: () => void;
  beginQuestion: () => boolean;
  cancelQuestion: () => void;
  index: DataIndex | null;
  loading: boolean;
  error: string | null;
  fullName: string;
  defaultBranch?: string;
  onRebuild: () => void;
  onExplore: (target: XRayExploreTarget) => void;
};

function KindIcon({ kind }: { kind: XRayFeatureKind }) {
  const cls = "size-4 text-[#5a7388]";
  switch (kind) {
    case "auth":
      return <Lock className={cls} aria-hidden />;
    case "dashboard":
      return <LayoutGrid className={cls} aria-hidden />;
    case "payments":
      return <CreditCard className={cls} aria-hidden />;
    case "settings":
      return <Settings className={cls} aria-hidden />;
    case "users":
      return <Users className={cls} aria-hidden />;
    default:
      return <Boxes className={cls} aria-hidden />;
  }
}

function StatusMark({ status }: { status: XRayFeatureStatus }) {
  if (status === "needs_review") {
    return (
      <AlertTriangle
        className="size-5 text-[#e07a3d]"
        aria-label="Needs review"
      />
    );
  }
  if (status === "connections_found") {
    return (
      <CheckCircle2
        className="size-5 text-[#2f9e6b]"
        aria-label="Connections found"
      />
    );
  }
  return (
    <CircleHelp className="size-5 text-[#9aa8b5]" aria-label="Not verified" />
  );
}

function statusCopy(status: XRayFeatureStatus): string {
  switch (status) {
    case "needs_review":
      return "Needs review";
    case "connections_found":
      return "Connections found";
    default:
      return "Not verified";
  }
}

function githubBlob(
  fullName: string,
  ref: string,
  file: string,
  line?: number,
): string {
  const url = `https://github.com/${fullName}/blob/${encodeURIComponent(ref)}/${file
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  return line ? `${url}#L${line}` : url;
}

function shortFile(path: string): string {
  const parts = path.split("/");
  return parts.slice(-2).join("/");
}

export function XRayPanel({
  accessToken,
  onNeedAuth,
  beginQuestion,
  cancelQuestion,
  index,
  loading,
  error,
  fullName,
  defaultBranch,
  onRebuild,
  onExplore,
}: Props) {
  const cached = getCachedFrontendArchScan(fullName, defaultBranch);
  const [frontend, setFrontend] = useState(cached);
  const [frontendBusy, setFrontendBusy] = useState(false);
  const [frontendError, setFrontendError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [featureQuery, setFeatureQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<XRayFeatureStatus | "all">(
    "all",
  );

  async function loadFrontend(force = false) {
    if (!accessToken) {
      onNeedAuth();
      return;
    }
    if (!force) {
      const hit = getCachedFrontendArchScan(fullName, defaultBranch);
      if (hit) {
        setFrontend(hit);
        return;
      }
    }
    setFrontendBusy(true);
    setFrontendError(null);
    try {
      const scan = await runFrontendArchScan(
        accessToken,
        { fullName, ref: defaultBranch },
        { force },
      );
      setFrontend(scan);
    } catch (err) {
      setFrontendError(
        toUserFacingError(err, "Could not map frontend files for X-Ray."),
      );
    } finally {
      setFrontendBusy(false);
    }
  }

  useEffect(() => {
    const hit = getCachedFrontendArchScan(fullName, defaultBranch);
    setFrontend(hit);
    setActiveId(null);
    setSelectedNodeId(null);
    setAskAnswer(null);
    setAskError(null);
    setQuestion("");
    setFeatureQuery("");
    setStatusFilter("all");
    if (!hit) void loadFrontend(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullName, defaultBranch, accessToken]);

  const report = useMemo(
    () =>
      buildXRay({
        index,
        frontend,
        fullName,
        appName: index?.appName,
        ref: defaultBranch,
      }),
    [index, frontend, fullName, defaultBranch],
  );

  const visibleFeatures = useMemo(() => {
    const q = featureQuery.trim().toLowerCase();
    return report.features.filter((feature) => {
      if (statusFilter !== "all" && feature.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        feature.name,
        feature.headline,
        feature.explanation,
        ...feature.nodes.map((node) => `${node.label} ${node.file || ""}`),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [report.features, featureQuery, statusFilter]);

  useEffect(() => {
    if (!report.features.length) {
      setActiveId(null);
      return;
    }
    if (!activeId || !report.features.some((f) => f.id === activeId)) {
      setActiveId(report.features[0]!.id);
      setSelectedNodeId(null);
    }
  }, [report.features, activeId]);

  const active =
    report.features.find((f) => f.id === activeId) || report.features[0] || null;
  const selectedNode: XRayNode | null =
    active?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  async function onAsk(event: React.FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || !active) return;
    if (!accessToken) {
      onNeedAuth();
      return;
    }
    if (!beginQuestion()) return;
    setAskBusy(true);
    setAskError(null);
    try {
      const result = await askXRayFeature(accessToken, {
        question: q,
        feature: {
          name: active.name,
          headline: active.headline,
          explanation: active.explanation,
          connections: active.connections,
          verifyNext: active.verifyNext,
          findings: active.findings.map((f) => ({
            title: f.title,
            summary: f.summary,
            contradiction: f.contradiction,
            evidence: f.evidence,
          })),
          relevantCode: active.relevantCode,
          selectedNode: selectedNode
            ? {
                label: selectedNode.label,
                kind: selectedNode.kind,
                file: selectedNode.file,
              }
            : undefined,
        },
      });
      setAskAnswer(result.answer);
    } catch (err) {
      cancelQuestion();
      setAskError(
        toUserFacingError(err, "Could not explain that feature. Try again in a moment."),
      );
    } finally {
      setAskBusy(false);
    }
  }

  const scanning = (loading && !index) || (frontendBusy && !frontend && !index);
  const owner = fullName.includes("/") ? fullName.split("/")[0] : "SeeThrough";
  const repoLabel = report.appName;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f7fafc]">
      {error ? (
        <p className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {frontendError && !frontend ? (
        <p className="shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {frontendError} Feature map still uses the repository index.
        </p>
      ) : null}

      {scanning ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
          <div className="relative mb-6 flex size-16 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#2a5f7a]/15" />
            <ScanSearch className="relative size-8 text-[#2a5f7a]" aria-hidden />
          </div>
          <p className="text-lg font-semibold tracking-tight text-[#17324a]">
            Mapping what this app built
          </p>
          <p className="mt-1 font-mono text-sm text-[#5a7388]">{fullName}</p>
          <ul className="mt-8 w-full max-w-sm space-y-3">
            {[
              "Finding features in pages and APIs",
              "Marking disconnected or risky paths",
              "Preparing explanations with file references",
            ].map((step) => (
              <li
                key={step}
                className="flex items-center gap-3 rounded-xl border border-[#e5eef4] bg-white px-4 py-3 text-sm text-[#3d5166] shadow-sm"
              >
                <Loader2 className="size-3.5 animate-spin text-[#2a5f7a]" />
                {step}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            <div className="rounded-2xl border border-[#e5eef4] bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[#17324a]">
                    <ScanSearch className="size-4 shrink-0 text-[#2a5f7a]" aria-hidden />
                    <h2 className="truncate text-[15px] font-semibold tracking-tight">
                      <span className="text-[#7a93a8]">{owner} / </span>
                      {repoLabel}
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-[#7a93a8]">
                    Select a feature to explore
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-[#e5eef4] bg-[#f7fafc] px-2.5 py-0.5 text-xs font-medium text-[#5a7388]">
                    {index?.source === "ai" ? "Indexed scan" : "Source scan"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onRebuild();
                      void loadFrontend(true);
                    }}
                    disabled={loading || frontendBusy}
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-[#e5eef4] text-[#17324a] hover:bg-[#f4f8fb] disabled:opacity-50"
                    aria-label="Scan again"
                  >
                    {loading || frontendBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {report.truncated ? (
                <p className="mt-3 rounded-xl border border-[#f3e2c2] bg-[#fff8ee] px-3 py-2 text-sm text-[#8a5a12]">
                  This inventory is partial. The scan did not read every file,
                  so some features may be missing.
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#eef3f7] px-2.5 py-1 text-xs font-medium text-[#3d5166]">
                  {report.featureCount}{" "}
                  {report.featureCount === 1 ? "feature" : "features"}
                </span>
                {report.needsReviewCount > 0 ? (
                  <span className="rounded-full bg-[#fff1e8] px-2.5 py-1 text-xs font-medium text-[#c45c22]">
                    {report.needsReviewCount} need review
                  </span>
                ) : (
                  <span className="rounded-full bg-[#e8f7ef] px-2.5 py-1 text-xs font-medium text-[#1f7a52]">
                    No review flags
                  </span>
                )}
              </div>

              {report.features.length === 0 ? (
                <div className="mt-8 rounded-xl border border-dashed border-[#d7e3ec] px-4 py-10 text-center">
                  <p className="text-sm font-medium text-[#17324a]">
                    No features mapped yet
                  </p>
                  <p className="mt-1 text-sm text-[#5a7388]">
                    {report.truncated
                      ? "The inventory is partial because the scan did not read every file."
                      : "This repository did not expose pages or APIs in the files we could read."}
                  </p>
                  <button
                    type="button"
                    onClick={onRebuild}
                    className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#17324a] px-3 text-sm font-semibold text-white"
                  >
                    <RefreshCw className="size-3.5" />
                    Scan again
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      value={featureQuery}
                      onChange={(event) => setFeatureQuery(event.target.value)}
                      placeholder="Search features"
                      aria-label="Search features"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-[#d7e3ec] bg-white px-3 text-sm text-[#17324a] placeholder:text-[#9aafc0] focus-visible:border-[#2a5f7a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2a5f7a]/20"
                    />
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Feature status">
                      {(
                        [
                          ["all", "All"],
                          ["needs_review", "Needs review"],
                          ["connections_found", "Connected"],
                          ["not_verified", "Not verified"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setStatusFilter(id)}
                          className={
                            statusFilter === id
                              ? "rounded-full bg-[#17324a] px-2.5 py-1 text-xs font-medium text-white"
                              : "rounded-full bg-[#eef3f7] px-2.5 py-1 text-xs font-medium text-[#3d5166]"
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {visibleFeatures.length === 0 ? (
                    <p className="mt-6 text-sm text-[#5a7388]">
                      No features match that filter.
                    </p>
                  ) : (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {visibleFeatures.map((feature) => {
                      const selected = feature.id === active?.id;
                      return (
                        <button
                          key={feature.id}
                          type="button"
                          onClick={() => {
                            setActiveId(feature.id);
                            setSelectedNodeId(null);
                            setAskAnswer(null);
                            setAskError(null);
                          }}
                          className={
                            selected
                              ? "rounded-xl border-2 border-[#c9d7ea] bg-white p-4 text-left shadow-sm ring-2 ring-[#e8f0fa]"
                              : "rounded-xl border border-[#e8eef3] bg-[#f8fafc] p-4 text-left hover:border-[#d7e3ec] hover:bg-white"
                          }
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="flex size-8 items-center justify-center rounded-lg bg-white text-[#5a7388] shadow-[inset_0_0_0_1px_#e8eef3]">
                              <KindIcon kind={feature.kind} />
                            </span>
                            <StatusMark status={feature.status} />
                          </div>
                          <p className="mt-3 text-[15px] font-semibold text-[#17324a]">
                            {feature.name}
                          </p>
                          <p className="mt-0.5 truncate text-sm text-[#7a93a8]">
                            {feature.nodes.find((node) => node.file)?.file
                              ? shortFile(
                                  feature.nodes.find((node) => node.file)!.file!,
                                )
                              : statusCopy(feature.status)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  )}

                  {active && visibleFeatures.some((feature) => feature.id === active.id) ? (
                    <FeatureDetail
                      feature={active}
                      selectedNode={selectedNode}
                      onSelectNode={(node) =>
                        setSelectedNodeId((id) =>
                          id === node.id ? null : node.id,
                        )
                      }
                      fullName={report.fullName}
                      refName={report.ref}
                      question={question}
                      onQuestionChange={setQuestion}
                      onAsk={onAsk}
                      askBusy={askBusy}
                      askError={askError}
                      askAnswer={askAnswer}
                      onExplore={() => onExplore(active.explore)}
                    />
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureDetail({
  feature,
  selectedNode,
  onSelectNode,
  fullName,
  refName,
  question,
  onQuestionChange,
  onAsk,
  askBusy,
  askError,
  askAnswer,
  onExplore,
}: {
  feature: XRayFeature;
  selectedNode: XRayNode | null;
  onSelectNode: (node: XRayNode) => void;
  fullName: string;
  refName: string;
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: (event: React.FormEvent) => void;
  askBusy: boolean;
  askError: string | null;
  askAnswer: string | null;
  onExplore: () => void;
}) {
  const issue = feature.status === "needs_review";
  const explanation = selectedNode
    ? nodeBeginnerBlurb(selectedNode, feature)
    : feature.explanation;

  return (
    <div className="mt-6 border-t border-[#eef3f7] pt-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-tight text-[#17324a]">
          {feature.name}
        </h3>
        {issue ? (
          <span className="rounded-full bg-[#fff1e8] px-2.5 py-1 text-xs font-medium text-[#c45c22]">
            Potential issue
          </span>
        ) : feature.status === "not_verified" ? (
          <span className="rounded-full bg-[#eef3f7] px-2.5 py-1 text-xs font-medium text-[#5a7388]">
            Not verified
          </span>
        ) : (
          <span className="rounded-full bg-[#e8f7ef] px-2.5 py-1 text-xs font-medium text-[#1f7a52]">
            Connections found
          </span>
        )}
      </div>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[#3d5166]">
        {feature.headline}
      </p>

      {feature.connections.length > 0 ? (
        <section className="mt-6">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-[#8aa0b3]">
            HOW IT CONNECTS
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm text-[#17324a]">
            {feature.nodes.map((node, i) => {
              const selected = selectedNode?.id === node.id;
              const flagged = feature.findings.some((f) =>
                f.evidence.some(
                  (e) =>
                    node.file &&
                    (e.file === node.file || e.file.endsWith(node.file)),
                ),
              );
              return (
                <span key={node.id} className="inline-flex items-center">
                  {i > 0 ? (
                    <span className="mx-1 text-[#b0c0ce]" aria-hidden>
                      →
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onSelectNode(node)}
                    className={
                      selected
                        ? "rounded-md bg-[#17324a] px-2 py-0.5 font-medium text-white"
                        : flagged
                          ? "rounded-md bg-[#fff1e8] px-2 py-0.5 font-medium text-[#9a4a16] hover:bg-[#ffe4d1]"
                          : "rounded-md px-2 py-0.5 font-medium hover:bg-[#f4f8fb]"
                    }
                  >
                    {node.label}
                  </button>
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-[#8aa0b3]">
          AI EXPLANATION
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#3d5166]">
          {explanation}
        </p>
        {feature.relevantCode.length > 0 ? (
          <p className="mt-3 text-sm text-[#7a93a8]">
            Relevant code:{" "}
            {feature.relevantCode.map((code, i) => (
              <span key={`${code.file}:${code.startLine ?? ""}`}>
                {i > 0 ? ", " : null}
                <a
                  href={githubBlob(fullName, refName, code.file, code.startLine)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[#2a5f7a] hover:underline"
                >
                  {shortFile(code.file)}
                  {code.startLine ? `:${code.startLine}` : ""}
                </a>
              </span>
            ))}
          </p>
        ) : null}
        {selectedNode?.file ? (
          <p className="mt-1 text-sm text-[#7a93a8]">
            Selected:{" "}
            <a
              href={githubBlob(fullName, refName, selectedNode.file)}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[#2a5f7a] hover:underline"
            >
              {selectedNode.file}
            </a>
          </p>
        ) : null}
      </section>

      {feature.verifyNext.length > 0 ? (
        <section className="mt-6">
          <p className="text-sm font-semibold text-[#17324a]">
            What to verify next
          </p>
          <ul className="mt-2 space-y-2">
            {feature.verifyNext.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 text-sm text-[#3d5166]"
              >
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#c5d2dc]"
                  aria-hidden
                />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <button
        type="button"
        onClick={onExplore}
        className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#111827] text-sm font-semibold text-white transition hover:bg-black"
      >
        Explore implementation →
      </button>

      <form onSubmit={onAsk} className="mt-5">
        <label htmlFor="xray-ask" className="sr-only">
          Ask about this feature
        </label>
        <div className="flex gap-2">
          <input
            id="xray-ask"
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder={`Ask about ${feature.name.toLowerCase()}…`}
            maxLength={500}
            className="h-11 min-w-0 flex-1 rounded-xl border border-[#d7e3ec] bg-white px-3.5 text-sm text-[#17324a] placeholder:text-[#9aafc0] focus-visible:border-[#2a5f7a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2a5f7a]/20"
          />
          <button
            type="submit"
            disabled={askBusy || !question.trim()}
            className="inline-flex h-11 shrink-0 items-center rounded-xl bg-[#17324a] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {askBusy ? "Asking…" : "Ask"}
          </button>
        </div>
        {askError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {askError}
          </p>
        ) : null}
        {askAnswer ? (
          <p className="mt-3 rounded-xl bg-[#f4f8fb] px-3.5 py-3 text-sm leading-relaxed text-[#3d5166]">
            {askAnswer}
          </p>
        ) : null}
      </form>
    </div>
  );
}
