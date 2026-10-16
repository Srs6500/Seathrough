"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Link2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { RepoAnalyzerDashboard } from "@/components/bug-analyzer/RepoAnalyzerDashboard";
import type {
  ArchitectureReport,
  LogicalFinding,
} from "@/lib/bug-analyzer/analyzeLogicalGaps";
import type {
  DataIndex,
  FeatureFlow,
  FlowNode,
} from "@/lib/bug-analyzer/buildDataIndex";

type Props = {
  index: DataIndex | null;
  loading: boolean;
  error: string | null;
  onRebuild: () => void;
  repoFullName?: string;
  onBack?: () => void;
};

type ViewMode = "analyzer" | "explorer";

function kindLabel(kind: string): string {
  switch (kind) {
    case "page":
      return "Page";
    case "component":
      return "Component";
    case "function":
      return "Function";
    case "hook":
      return "Hook";
    case "service":
      return "Service";
    case "api":
      return "API";
    default:
      return "Other";
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

/** Match an Explorer flow node to Analyzer findings (file / label / flow text). */
function findingsForExplorerNode(
  node: FlowNode,
  feature: FeatureFlow,
  report: ArchitectureReport | undefined,
): LogicalFinding[] {
  if (!report?.findings?.length) return [];

  const labelN = norm(node.label);
  const fileN = node.file ? norm(node.file) : "";
  const baseN = node.file ? norm(basename(node.file)) : "";
  const featureN = norm(feature.name);

  const archNodes = report.nodes.filter((n) => {
    if (node.file && n.file && (n.file === node.file || norm(n.file) === fileN))
      return true;
    if (n.label && norm(n.label) === labelN) return true;
    if (n.subtitle && norm(n.subtitle) === labelN) return true;
    if (baseN && n.file && norm(basename(n.file)) === baseN) return true;
    // Login Page ↔ /login
    if (
      node.kind === "page" &&
      n.layer === "frontend" &&
      n.route &&
      (labelN.includes(norm(n.route.replace(/^\//, ""))) ||
        norm(n.label).includes(labelN) ||
        labelN.includes(norm(n.label)))
    ) {
      return true;
    }
    if (
      node.kind === "service" &&
      n.layer === "service" &&
      (norm(n.label).includes(labelN) || labelN.includes(norm(n.label)))
    ) {
      return true;
    }
    return false;
  });

  const archIds = new Set(archNodes.map((n) => n.id));

  const scored = report.findings
    .map((f) => {
      let score = 0;
      if (f.nodeIds.some((id) => archIds.has(id))) score += 5;
      if (node.file && f.evidence.some((e) => e.file === node.file)) score += 4;
      if (f.flow.some((step) => norm(step) === labelN || norm(step).includes(labelN)))
        score += 3;
      if (
        featureN &&
        (norm(f.category).includes(featureN) ||
          norm(f.title).includes(featureN) ||
          featureN.includes(norm(f.category)))
      ) {
        score += 1;
      }
      // Auth feature + login/auth nodes
      if (
        /auth/i.test(feature.name) &&
        /login|signin|signup|auth|credential/i.test(
          `${node.label} ${node.file || ""} ${f.title}`,
        )
      ) {
        score += 2;
      }
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((x) => x.f);
}

function worstSeverity(
  findings: LogicalFinding[],
): "critical" | "high" | "medium" | "low" | null {
  if (!findings.length) return null;
  const order = ["critical", "high", "medium", "low"] as const;
  for (const s of order) {
    if (findings.some((f) => f.severity === s)) return s;
  }
  return null;
}

function FeatureFlowDiagram({
  feature,
  report,
  onOpenFinding,
}: {
  feature: FeatureFlow;
  report: ArchitectureReport | undefined;
  onOpenFinding: (findingId: string) => void;
}) {
  return (
    <div className="mt-5">
      <h3 className="text-[15px] font-semibold tracking-tight text-[#111827]">
        {feature.title}
      </h3>
      <ol className="mt-5 flex flex-col items-stretch gap-0">
        {feature.nodes.map((node, i) => {
          const hits = findingsForExplorerNode(node, feature, report);
          const severity = worstSeverity(hits);
          const hasProblem = Boolean(severity);
          const isCritical = severity === "critical" || severity === "high";
          const top = hits[0];

          const boxClass = hasProblem
            ? isCritical
              ? "border-red-300 bg-red-50 hover:border-red-400 hover:bg-red-100/80 cursor-pointer"
              : "border-amber-300 bg-amber-50 hover:border-amber-400 hover:bg-amber-100/80 cursor-pointer"
            : "border-[#e5e7eb] bg-[#f3f4f6]";

          const inner = (
            <>
              <div className="flex items-start justify-center gap-2">
                {hasProblem ? (
                  isCritical ? (
                    <XCircle
                      className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                      aria-hidden
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                      aria-hidden
                    />
                  )
                ) : null}
                <div className="min-w-0">
                  <p
                    className={`text-[15px] font-semibold ${
                      hasProblem && isCritical
                        ? "text-red-900"
                        : hasProblem
                          ? "text-amber-950"
                          : "text-[#111827]"
                    }`}
                  >
                    {node.label}
                  </p>
                  <p
                    className={`mt-0.5 text-[12px] ${
                      hasProblem ? "text-red-700/80" : "text-[#6b7280]"
                    }`}
                  >
                    {kindLabel(node.kind)}
                    {top ? ` · ${top.severity} issue` : ""}
                  </p>
                  {top ? (
                    <p className="mt-1 line-clamp-2 text-[11px] text-red-800/90">
                      {top.title}
                    </p>
                  ) : null}
                </div>
              </div>
              {hasProblem ? (
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-red-600">
                  Open in Analyzer →
                </p>
              ) : null}
            </>
          );

          return (
            <li key={node.id} className="flex flex-col items-center">
              {hasProblem && top ? (
                <button
                  type="button"
                  onClick={() => onOpenFinding(top.id)}
                  className={`w-full max-w-md rounded-xl border px-5 py-3.5 text-center shadow-[0_1px_0_rgba(0,0,0,0.02)] transition ${boxClass}`}
                >
                  {inner}
                </button>
              ) : (
                <div
                  className={`w-full max-w-md rounded-xl border px-5 py-3.5 text-center shadow-[0_1px_0_rgba(0,0,0,0.02)] ${boxClass}`}
                >
                  {inner}
                </div>
              )}
              {i < feature.nodes.length - 1 ? (
                <div
                  className={`flex h-7 items-center justify-center ${
                    hasProblem && isCritical ? "text-red-300" : "text-[#9ca3af]"
                  }`}
                  aria-hidden
                >
                  <svg width="14" height="18" viewBox="0 0 14 18" fill="none">
                    <path
                      d="M7 1v12M3 9l4 5 4-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ExplorerPanel({
  index,
  onOpenFinding,
}: {
  index: DataIndex;
  onOpenFinding: (findingId: string) => void;
}) {
  const features = index.features ?? [];
  const report = index.architecture;
  const [activeId, setActiveId] = useState<string | null>(
    features[0]?.id ?? null,
  );

  useEffect(() => {
    if (!features.length) {
      setActiveId(null);
      return;
    }
    if (!activeId || !features.some((f) => f.id === activeId)) {
      setActiveId(features[0]!.id);
    }
  }, [features, activeId]);

  const active =
    features.find((f) => f.id === activeId) || features[0] || null;

  const featureProblems = useMemo(() => {
    const map = new Map<string, LogicalFinding[]>();
    for (const f of features) {
      const hits: LogicalFinding[] = [];
      const seen = new Set<string>();
      for (const node of f.nodes) {
        for (const finding of findingsForExplorerNode(node, f, report)) {
          if (!seen.has(finding.id)) {
            seen.add(finding.id);
            hits.push(finding);
          }
        }
      }
      map.set(f.id, hits);
    }
    return map;
  }, [features, report]);

  const hasAnyProblems = [...featureProblems.values()].some((h) => h.length > 0);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-[#e5e7eb] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 shrink-0 text-[#6b7280]" aria-hidden />
              <h2 className="text-base font-semibold text-[#111827]">
                Repository Explorer
              </h2>
            </div>
            <p className="mt-1 text-[13px] text-[#6b7280]">
              <span className="font-medium text-[#374151]">{index.appName}</span>
              <span className="mx-1.5 text-[#d1d5db]">/</span>
              Application structure
            </p>
          </div>
          <span
            className={
              hasAnyProblems
                ? "shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-700"
                : "shrink-0 rounded-full bg-[#dcfce7] px-2.5 py-0.5 text-[11px] font-semibold text-[#15803d]"
            }
          >
            {hasAnyProblems ? "Issues found" : "Indexed"}
          </span>
        </div>

        {features.length > 0 ? (
          <>
            <div className="mt-5 flex flex-wrap gap-2">
              {features.map((f) => {
                const selected = f.id === active?.id;
                const problems = featureProblems.get(f.id) || [];
                const bad = problems.length > 0;
                const critical = problems.some(
                  (p) => p.severity === "critical" || p.severity === "high",
                );
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActiveId(f.id)}
                    className={
                      selected
                        ? bad
                          ? critical
                            ? "rounded-full bg-red-700 px-3.5 py-1.5 text-[13px] font-medium text-white"
                            : "rounded-full bg-amber-700 px-3.5 py-1.5 text-[13px] font-medium text-white"
                          : "rounded-full bg-[#111827] px-3.5 py-1.5 text-[13px] font-medium text-white"
                        : bad
                          ? critical
                            ? "rounded-full border border-red-300 bg-red-50 px-3.5 py-1.5 text-[13px] font-medium text-red-800 hover:bg-red-100"
                            : "rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-[13px] font-medium text-amber-900 hover:bg-amber-100"
                          : "rounded-full border border-[#e5e7eb] bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb]"
                    }
                  >
                    {f.name}
                    {bad ? ` · ${problems.length}` : ""}
                  </button>
                );
              })}
            </div>
            {active ? (
              <FeatureFlowDiagram
                feature={active}
                report={report}
                onOpenFinding={onOpenFinding}
              />
            ) : null}
            {active ? (
              <div className="mt-8 border-t border-[#f3f4f6] pt-5">
                <p className="text-[13px] font-semibold text-[#111827]">
                  AI explanation
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-[#4b5563]">
                  {active.explanation}
                </p>
                {(featureProblems.get(active.id) || []).length > 0 ? (
                  <p className="mt-3 text-[11px] text-red-600">
                    Red boxes have linked Analyzer findings — click one to
                    inspect evidence and fixes.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-6 text-sm text-[#6b7280]">
            No feature flows yet. Use Analyzer for gap findings, or re-index the
            entire repo.
          </p>
        )}
      </div>
    </div>
  );
}

function ScanLoadingState({ repoFullName }: { repoFullName?: string }) {
  const steps = [
    "Reading pages and routes",
    "Mapping APIs and services",
    "Inferring intent vs implementation",
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="relative mb-6 flex size-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#2a5f7a]/15" />
        <span className="absolute inset-2 animate-pulse rounded-full bg-[#2a5f7a]/10" />
        <Loader2
          className="relative size-8 animate-spin text-[#2a5f7a]"
          aria-hidden
        />
      </div>
      <p className="text-lg font-semibold tracking-tight text-[#17324a]">
        Analyzing repository
      </p>
      {repoFullName ? (
        <p className="mt-1 font-mono text-sm text-[#5a7388]">{repoFullName}</p>
      ) : null}
      <ul className="mt-8 w-full max-w-sm space-y-3">
        {steps.map((step, i) => (
          <li
            key={step}
            className="flex items-center gap-3 rounded-xl border border-[#e5eef4] bg-white px-4 py-3 text-sm text-[#3d5166] shadow-sm"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <span
              className="size-2 shrink-0 animate-pulse rounded-full bg-[#2a5f7a]"
              style={{ animationDelay: `${i * 200}ms` }}
            />
            {step}
          </li>
        ))}
      </ul>
      <div className="mt-8 h-1 w-48 overflow-hidden rounded-full bg-[#e5eef4]">
        <div className="bug-analyzer-scan-bar h-full w-1/3 rounded-full bg-[#2a5f7a]" />
      </div>
    </div>
  );
}

export function DataIndexView({
  index,
  loading,
  error,
  onRebuild,
  repoFullName,
  onBack,
}: Props) {
  const hasArchitecture = Boolean(index?.architecture);
  const [mode, setMode] = useState<ViewMode>("analyzer");
  const [focusFindingId, setFocusFindingId] = useState<string | null>(null);

  useEffect(() => {
    if (index?.architecture) setMode("analyzer");
    else if (index?.features?.length) setMode("explorer");
    setFocusFindingId(null);
  }, [index?.architecture, index?.features?.length, index?.indexHash]);

  function openFindingInAnalyzer(findingId: string) {
    setFocusFindingId(findingId);
    setMode("analyzer");
  }

  const issueCount = index?.architecture?.findings.length ?? 0;
  const featureCount = index?.features?.length ?? 0;
  const title = repoFullName || index?.appName || "Repository";
  const owner = title.includes("/") ? title.split("/")[0] : null;
  const repoName = title.includes("/") ? title.split("/").slice(1).join("/") : title;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7fafc]">
      <header className="shrink-0 border-b border-[#e5eef4] bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#e5eef4] bg-white text-[#17324a] transition hover:bg-[#f4f8fb]"
              aria-label="Back to repositories"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              {owner ? (
                <span className="truncate text-sm text-[#7a93a8]">{owner}/</span>
              ) : null}
              <h1 className="truncate text-base font-semibold tracking-tight text-[#17324a] sm:text-lg">
                {repoName}
              </h1>
            </div>
            <p className="mt-0.5 truncate text-xs text-[#7a93a8]">
              {loading && !index
                ? "Scanning entire repository…"
                : [
                    "Entire repo",
                    featureCount ? `${featureCount} features` : null,
                    issueCount ? `${issueCount} issues` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {index ? (
              <div
                className="flex rounded-lg border border-[#e5eef4] bg-[#f7fafc] p-0.5"
                role="group"
                aria-label="View mode"
              >
                <button
                  type="button"
                  onClick={() => setMode("analyzer")}
                  disabled={!hasArchitecture}
                  className={
                    mode === "analyzer"
                      ? "rounded-md bg-[#17324a] px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-md px-3 py-1.5 text-xs font-medium text-[#5a7388] disabled:opacity-40"
                  }
                >
                  Analyzer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("explorer");
                    setFocusFindingId(null);
                  }}
                  className={
                    mode === "explorer"
                      ? "rounded-md bg-[#17324a] px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-md px-3 py-1.5 text-xs font-medium text-[#5a7388]"
                  }
                >
                  Explorer
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={onRebuild}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#e5eef4] bg-white px-3 text-xs font-semibold text-[#17324a] transition hover:bg-[#f4f8fb] disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden />
              )}
              {loading ? "Scanning…" : "Scan again"}
            </button>
          </div>
        </div>

        {loading && index ? (
          <div className="h-0.5 w-full overflow-hidden bg-[#e5eef4]">
            <div className="bug-analyzer-scan-bar h-full w-1/3 bg-[#2a5f7a]" />
          </div>
        ) : null}
      </header>

      {error ? (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading && !index ? (
        <ScanLoadingState repoFullName={repoFullName} />
      ) : !index ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm font-medium text-[#17324a]">No analysis yet</p>
          <p className="max-w-md text-sm text-[#5a7388]">
            Scan the repository to infer intent from code and surface logical
            gaps — no setup questions.
          </p>
          <button
            type="button"
            onClick={onRebuild}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-[#17324a] px-4 text-sm font-semibold text-white"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Analyze repository
          </button>
        </div>
      ) : mode === "analyzer" && index.architecture ? (
        <div className="relative min-h-0 flex-1">
          {loading ? (
            <div className="absolute inset-0 z-10 flex items-start justify-center bg-[#f7fafc]/70 pt-16 backdrop-blur-[1px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#e5eef4] bg-white px-4 py-2 text-sm font-medium text-[#17324a] shadow-sm">
                <Loader2 className="size-4 animate-spin text-[#2a5f7a]" />
                Re-scanning…
              </div>
            </div>
          ) : null}
          <RepoAnalyzerDashboard
            key={focusFindingId || "default"}
            report={index.architecture}
            appName={index.appName}
            focusFindingId={focusFindingId}
          />
        </div>
      ) : (
        <ExplorerPanel index={index} onOpenFinding={openFindingInAnalyzer} />
      )}
    </div>
  );
}
