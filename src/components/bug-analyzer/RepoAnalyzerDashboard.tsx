"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  XCircle,
} from "lucide-react";
import type {
  ArchNode,
  ArchitectureReport,
  FindingSeverity,
  LogicalFinding,
  NodeHealth,
} from "@/lib/bug-analyzer/analyzeLogicalGaps";

type DetailTab = "overview" | "evidence" | "code" | "fix" | "related";

const LAYER_ORDER = ["frontend", "api", "service", "external"] as const;
const LAYER_TITLE: Record<(typeof LAYER_ORDER)[number], string> = {
  frontend: "Frontend (Next.js)",
  api: "API Routes (Next.js)",
  service: "Services / Logic",
  external: "External Services",
};

function HealthIcon({ health }: { health: NodeHealth }) {
  if (health === "ok") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  }
  if (health === "critical" || health === "missing") {
    return <XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden />;
  }
  if (health === "warning") {
    return (
      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
    );
  }
  return <CircleDashed className="h-3.5 w-3.5 text-zinc-400" aria-hidden />;
}

function nodeBorder(health: NodeHealth, selected: boolean): string {
  if (selected) return "border-sky-500 ring-2 ring-sky-200";
  switch (health) {
    case "ok":
      return "border-emerald-300 bg-emerald-50/80";
    case "critical":
    case "missing":
      return "border-red-300 bg-red-50/90";
    case "warning":
      return "border-amber-300 bg-amber-50/80";
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-500";
  }
}

function severityStyles(severity: FindingSeverity): string {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-700";
    case "high":
      return "bg-orange-100 text-orange-700";
    case "medium":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

function statusLabel(status: LogicalFinding["status"]): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "likely":
      return "Likely";
    default:
      return "Unknown";
  }
}

type Props = {
  report: ArchitectureReport;
  appName: string;
  /** Open with this finding selected (e.g. from Explorer click). */
  focusFindingId?: string | null;
};

export function RepoAnalyzerDashboard({
  report,
  appName,
  focusFindingId = null,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    focusFindingId || report.findings[0]?.id || null,
  );
  const [tab, setTab] = useState<DetailTab>("overview");
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());

  const selected = useMemo(
    () => report.findings.find((f) => f.id === selectedId) ?? null,
    [report.findings, selectedId],
  );

  useEffect(() => {
    if (focusFindingId && report.findings.some((f) => f.id === focusFindingId)) {
      setSelectedId(focusFindingId);
      return;
    }
    if (!selectedId && report.findings[0]) {
      setSelectedId(report.findings[0].id);
    }
  }, [focusFindingId, report.findings, selectedId]);

  useEffect(() => {
    if (selected) {
      setHighlightNodes(new Set(selected.nodeIds));
      setTab("overview");
    }
  }, [selected]);

  const byLayer = useMemo(() => {
    const map = new Map<string, ArchNode[]>();
    for (const layer of LAYER_ORDER) map.set(layer, []);
    for (const n of report.nodes) {
      map.get(n.layer)?.push(n);
    }
    return map;
  }, [report.nodes]);

  function selectFinding(f: LogicalFinding) {
    setSelectedId(f.id);
    setHighlightNodes(new Set(f.nodeIds));
  }

  function selectNode(node: ArchNode) {
    setHighlightNodes(new Set([node.id]));
    const related = report.findings.find((f) => f.nodeIds.includes(node.id));
    if (related) setSelectedId(related.id);
  }

  const criticalCount = report.findings.filter(
    (f) => f.severity === "critical",
  ).length;

  return (
    <div className="flex h-0 min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 lg:p-5">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-[#111827] sm:text-lg">
            Automatic repository analyzer
          </p>
          <p className="mt-0.5 text-sm text-[#6b7280]">
            {appName} · inferred intent vs implementation ·{" "}
            {report.findings.length} issues
            {criticalCount ? ` · ${criticalCount} critical` : ""} ·{" "}
            {report.source === "ai" ? "AI + structure" : "structure scan"}
          </p>
        </div>
      </div>

      {/* Architecture diagram — each layer column scrolls independently */}
      <div className="flex h-0 min-h-0 flex-[1.6] flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-sm">
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0 overflow-x-auto px-4 pt-4 sm:px-5 sm:pt-5">
            <div className="grid h-full min-w-[56rem] grid-cols-4 grid-rows-[minmax(0,1fr)] gap-3">
              {LAYER_ORDER.map((layer) => (
                <div
                  key={layer}
                  className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                >
                  <p className="mb-2.5 shrink-0 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                    {LAYER_TITLE[layer]}
                  </p>
                  <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1 pb-2 [scrollbar-gutter:stable] max-h-[calc(100dvh-11rem)]">
                    {(byLayer.get(layer) || []).map((node) => {
                      const lit = highlightNodes.has(node.id);
                      return (
                        <li key={node.id}>
                          <button
                            type="button"
                            onClick={() => selectNode(node)}
                            className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${nodeBorder(
                              node.health,
                              lit,
                            )}`}
                          >
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5">
                                <HealthIcon health={node.health} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-[#111827]">
                                  {node.label}
                                </p>
                                {node.subtitle ? (
                                  <p className="truncate font-mono text-xs text-[#6b7280]">
                                    {node.subtitle}
                                  </p>
                                ) : null}
                                {node.note ? (
                                  <p className="mt-1 line-clamp-2 text-xs text-[#4b5563]">
                                    {node.note}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                    {(byLayer.get(layer) || []).length === 0 ? (
                      <li className="rounded-lg border border-dashed border-[#e5e7eb] px-2 py-3 text-center text-sm text-[#9ca3af]">
                        None detected
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
        {selected?.flow?.length ? (
          <p className="shrink-0 border-t border-[#f3f4f6] px-4 py-2.5 text-sm text-[#6b7280] sm:px-5">
            Selected flow:{" "}
            <span className="font-medium text-[#374151]">
              {selected.flow.join(" → ")}
            </span>
          </p>
        ) : (
          <p className="shrink-0 border-t border-[#f3f4f6] px-4 py-2.5 text-sm text-[#9ca3af] sm:px-5">
            Click a node or issue to highlight its path across the stack.
          </p>
        )}
      </div>

      {/* Issues + detail */}
      <div className="grid h-0 min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-sm">
          <div className="shrink-0 border-b border-[#e5e7eb] px-4 py-3.5">
            <p className="text-base font-semibold text-[#111827]">
              Issues Found ({report.findings.length})
            </p>
            <p className="mt-0.5 text-sm text-[#6b7280]">
              Confirmed / Likely / Unknown — never assumed certain without
              evidence
            </p>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {report.findings.length === 0 ? (
              <li className="px-2 py-6 text-center text-base text-[#6b7280]">
                No logical gaps detected from available evidence.
              </li>
            ) : (
              report.findings.map((f) => {
                const active = f.id === selected?.id;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => selectFinding(f)}
                      className={
                        active
                          ? "mb-1 w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-left"
                          : "mb-1 w-full rounded-lg border border-transparent px-3 py-3 text-left hover:bg-[#f9fafb]"
                      }
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${severityStyles(
                            f.severity,
                          )}`}
                        >
                          {f.severity}
                        </span>
                        <span className="rounded-full border border-[#e5e7eb] px-2.5 py-0.5 text-xs font-medium text-[#6b7280]">
                          {statusLabel(f.status)}
                        </span>
                        <span className="text-xs text-[#9ca3af]">
                          {f.category}
                        </span>
                      </div>
                      <p className="mt-1.5 text-base font-medium text-[#111827]">
                        {f.title}
                      </p>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-sm">
          {!selected ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-base text-[#6b7280]">
              Select an issue to inspect evidence and fix suggestions.
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-[#e5e7eb] px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-base font-semibold text-[#111827]">
                    {selected.title}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${severityStyles(
                      selected.severity,
                    )}`}
                  >
                    {selected.severity}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1 border-b border-transparent">
                  {(
                    [
                      ["overview", "Overview"],
                      ["evidence", "Evidence"],
                      ["code", "Code"],
                      ["fix", "Fix Suggestion"],
                      ["related", "Related"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={
                        tab === id
                          ? "rounded-md bg-[#111827] px-3 py-1.5 text-sm font-medium text-white"
                          : "rounded-md px-3 py-1.5 text-sm font-medium text-[#6b7280] hover:bg-[#f3f4f6]"
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5 text-base">
                {tab === "overview" ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#9ca3af]">
                        Flow in diagram
                      </p>
                      <p className="mt-1 font-medium text-[#111827]">
                        {selected.flow.join(" → ")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#9ca3af]">
                        Inferred intent
                      </p>
                      <p className="mt-1 text-[#374151]">
                        {selected.inferredIntent}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#9ca3af]">
                        Contradiction
                      </p>
                      <p className="mt-1 text-[#374151]">
                        {selected.contradiction}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#9ca3af]">
                        Status
                      </p>
                      <p className="mt-1 text-[#374151]">
                        {statusLabel(selected.status)} — {selected.summary}
                      </p>
                    </div>
                  </div>
                ) : null}

                {tab === "evidence" || tab === "code" ? (
                  <div className="space-y-3">
                    {selected.evidence.length === 0 ? (
                      <p className="text-[#6b7280]">No code evidence attached.</p>
                    ) : (
                      selected.evidence.map((ev, i) => (
                        <div key={`${ev.file}:${i}`}>
                          <p className="font-mono text-xs text-[#6b7280]">
                            {ev.file}
                            {ev.startLine ? `:${ev.startLine}` : ""}
                            {ev.note ? ` · ${ev.note}` : ""}
                          </p>
                          <pre className="mt-1.5 overflow-auto rounded-lg bg-[#0f172a] p-3.5 font-mono text-xs leading-5 text-[#e2e8f0]">
                            {ev.snippet || "// empty"}
                          </pre>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}

                {tab === "fix" ? (
                  <p className="leading-relaxed text-[#374151]">
                    {selected.fixSuggestion}
                  </p>
                ) : null}

                {tab === "related" ? (
                  <ul className="space-y-2">
                    {(selected.relatedFindingIds || [])
                      .map((id) => report.findings.find((f) => f.id === id))
                      .filter(Boolean)
                      .map((f) => (
                        <li key={f!.id}>
                          <button
                            type="button"
                            onClick={() => selectFinding(f!)}
                            className="text-left text-[#2563eb] hover:underline"
                          >
                            {f!.title}
                          </button>
                        </li>
                      ))}
                    {(selected.relatedFindingIds || []).length === 0 ? (
                      <li className="text-[#6b7280]">
                        Related nodes: {selected.nodeIds.join(", ") || "—"}
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
