"use client";

import { useEffect, useMemo, useState } from "react";
import { FrontendArchCanvas } from "@/components/bug-analyzer/FrontendArchCanvas";
import { Button } from "@/components/ui/button";
import {
  getCachedFrontendArchScan,
  runFrontendArchScan,
} from "@/lib/frontend-arch/client";
import type {
  FrontendArchFinding,
  FrontendArchScanResult,
} from "@/lib/frontend-arch/types";
import {
  buildPageFlowGraph,
  countHealthy,
  enrichNodes,
  relatedPageForFinding,
  shortFilePath,
  type ArchViewNode,
} from "@/lib/frontend-arch/viewModel";
import { toUserFacingError } from "@/lib/errors/userFacing";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Info,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";

type Props = {
  accessToken: string | null;
  onNeedAuth: () => void;
  fullName: string;
  defaultBranch?: string;
};

type Level = "overview" | "page";

function sortFindings(findings: FrontendArchFinding[]): FrontendArchFinding[] {
  const catRank: Record<string, number> = {
    buttons_and_forms: 0,
    api_integration: 1,
    navigation: 2,
    accessibility: 3,
    code_quality: 4,
    component_connections: 5,
  };
  const sevRank = { error: 0, warning: 1, info: 2 };
  return [...findings].sort((a, b) => {
    const s = sevRank[a.severity] - sevRank[b.severity];
    if (s !== 0) return s;
    return (catRank[a.category] ?? 9) - (catRank[b.category] ?? 9);
  });
}

export function FrontendArchitecturePanel({
  accessToken,
  onNeedAuth,
  fullName,
  defaultBranch,
}: Props) {
  const cached = getCachedFrontendArchScan(fullName, defaultBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<FrontendArchScanResult | null>(cached);
  const [level, setLevel] = useState<Level>("overview");
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    () => (cached ? sortFindings(cached.findings)[0]?.id ?? null : null),
  );
  const [focusNodeId, setFocusNodeId] = useState<string | null>(
    () =>
      cached
        ? sortFindings(cached.findings)[0]?.nodeId ?? null
        : null,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);

  async function runScan(force = false) {
    if (!accessToken) {
      onNeedAuth();
      return;
    }
    if (!force) {
      const hit = getCachedFrontendArchScan(fullName, defaultBranch);
      if (hit) {
        setScan(hit);
        setError(null);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const result = await runFrontendArchScan(
        accessToken,
        { fullName, ref: defaultBranch },
        { force },
      );
      setScan(result);
      if (force) {
        setLevel("overview");
        setActivePageId(null);
      }
      const sorted = sortFindings(result.findings);
      setSelectedFindingId(sorted[0]?.id ?? null);
      setFocusNodeId(sorted[0]?.nodeId ?? null);
    } catch (err) {
      setScan(null);
      setError(toUserFacingError(err, "Frontend architecture scan failed."));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const hit = getCachedFrontendArchScan(fullName, defaultBranch);
    if (hit) {
      setScan(hit);
      setError(null);
      return;
    }
    setScan(null);
    setLevel("overview");
    setActivePageId(null);
    setSelectedFindingId(null);
    setFocusNodeId(null);
    setError(null);
    void runScan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullName, defaultBranch, accessToken]);

  const pageFlow = useMemo(
    () =>
      scan && activePageId ? buildPageFlowGraph(scan, activePageId) : null,
    [scan, activePageId],
  );

  const graph = level === "page" ? pageFlow : null;

  const selected = useMemo(
    () => scan?.findings.find((f) => f.id === selectedFindingId) ?? null,
    [scan, selectedFindingId],
  );

  const pageCards = useMemo(() => {
    if (!scan) return [];
    return enrichNodes(
      scan.nodes.filter((n) => n.kind === "page"),
      scan.findings,
      scan,
    ).sort((a, b) => {
      const rank = { error: 0, warning: 1, healthy: 2 };
      const d = rank[a.health] - rank[b.health];
      return d !== 0 ? d : a.title.localeCompare(b.title);
    });
  }, [scan]);

  const findingsForSidebar = useMemo(() => {
    if (!scan) return [];
    let list = sortFindings(scan.findings);
    if (level === "page" && activePageId && pageFlow) {
      const ids = new Set(pageFlow.nodes.map((n) => n.id));
      const scoped = list.filter((f) => f.nodeId && ids.has(f.nodeId));
      if (scoped.length) list = scoped;
    }
    return list.slice(0, 24);
  }, [scan, level, activePageId, pageFlow]);

  function openPage(pageId: string, findingId?: string | null) {
    setLevel("page");
    setActivePageId(pageId);
    if (scan && findingId) {
      const finding = scan.findings.find((f) => f.id === findingId);
      setSelectedFindingId(findingId);
      setFocusNodeId(finding?.nodeId ?? pageId);
      return;
    }
    setFocusNodeId(pageId);
    if (scan) {
      const flow = buildPageFlowGraph(scan, pageId);
      const hit = sortFindings(scan.findings).find(
        (f) => f.nodeId && flow.nodes.some((n) => n.id === f.nodeId),
      );
      setSelectedFindingId(hit?.id ?? null);
    }
  }

  function openFinding(f: FrontendArchFinding) {
    setSelectedFindingId(f.id);
    setFocusNodeId(f.nodeId ?? null);
    if (!scan) return;
    const page = relatedPageForFinding(scan, f);
    if (page) openPage(page.id, f.id);
  }

  function onSelectNode(node: ArchViewNode) {
    setFocusNodeId(node.id);
    if (level === "overview" && node.kind === "page") {
      openPage(node.id);
      return;
    }
    const hit = scan?.findings.find((f) => f.nodeId === node.id);
    if (hit) setSelectedFindingId(hit.id);
  }

  function copyFinding(finding: FrontendArchFinding) {
    const text = [
      `Problem: ${finding.title}`,
      finding.summary,
      `File: ${finding.path}:${finding.startLine}`,
      finding.snippet ? `\nCode:\n${finding.snippet}` : "",
      `\nSuggested fix:\n${finding.suggestedFix}`,
    ].join("\n");
    void navigator.clipboard.writeText(text);
  }

  const activePage = pageCards.find((p) => p.id === activePageId);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#f8fafc]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e5eef4] bg-white px-3 py-2 sm:px-4">
        <div className="min-w-0 flex-1">
          {level === "page" ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setLevel("overview");
                  setActivePageId(null);
                  setFocusNodeId(null);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-[#475569] hover:bg-[#f1f5f9]"
              >
                <ChevronLeft className="size-4" />
                Pages
              </button>
              <span className="text-sm text-[#94a3b8]">/</span>
              <span className="truncate text-sm font-semibold text-[#17324a]">
                {activePage?.shortPath || "page flow"}
              </span>
            </div>
          ) : (
            <p className="truncate text-sm font-medium text-[#7a93a8]">
              {fullName}
            </p>
          )}
        </div>
        {scan ? (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5eef4] bg-[#f8fafc] px-2.5 py-1.5 text-sm font-medium text-[#475569] hover:bg-[#f1f5f9]"
          >
            <Info className="size-4 text-[#94a3b8]" />
            <span
              className={
                scan.stats.errors ? "font-semibold text-red-700" : undefined
              }
            >
              {scan.stats.errors} issues
            </span>
            <span className="text-[#cbd5e1]">·</span>
            <span
              className={
                scan.stats.warnings ? "text-amber-700" : undefined
              }
            >
              {scan.stats.warnings} suspected
            </span>
          </button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void runScan(true)}
        >
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Scanning…
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" />
              Re-analyze
            </>
          )}
        </Button>
      </div>

      {error ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {busy && !scan ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#5a7388]">
          <Loader2 className="size-4 animate-spin" />
          Building architecture from source…
        </div>
      ) : null}

      {scan ? (
        <>
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.85fr)]">
            <div className="flex min-h-0 flex-col border-r border-[#e5eef4]">
              {level === "overview" ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="shrink-0 px-4 pb-2 pt-3">
                    <p className="text-sm font-medium text-[#475569]">
                      Pages in this app
                    </p>
                    <p className="mt-0.5 text-sm text-[#94a3b8]">
                      Open a page to see its components, APIs, and connections.
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                      {pageCards.map((page) => (
                        <button
                          key={page.id}
                          type="button"
                          onClick={() => openPage(page.id)}
                          className={`rounded-xl border-2 bg-white p-3.5 text-left shadow-sm transition hover:shadow-md ${
                            page.health === "error"
                              ? "border-red-200"
                              : page.health === "warning"
                                ? "border-amber-200"
                                : "border-emerald-200"
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            {page.health === "error" ? (
                              <XCircle className="mt-0.5 size-5 text-red-600" />
                            ) : page.health === "warning" ? (
                              <AlertTriangle className="mt-0.5 size-5 text-amber-600" />
                            ) : (
                              <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold text-[#0f172a]">
                                {page.title.replace(/^Page\s+/i, "")}
                              </p>
                              <p className="truncate font-mono text-xs text-[#64748b]">
                                {page.shortPath}
                              </p>
                              <p
                                className={`mt-1.5 text-sm font-medium ${
                                  page.health === "error"
                                    ? "text-red-700"
                                    : page.health === "warning"
                                      ? "text-amber-800"
                                      : "text-emerald-700"
                                }`}
                              >
                                {page.issueLabel || "Healthy"}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : graph ? (
                <div className="min-h-0 flex-1 bg-[#f8fafc]">
                  <FrontendArchCanvas
                    nodes={graph.nodes}
                    edges={graph.edges}
                    focusNodeId={focusNodeId}
                    onSelectNode={onSelectNode}
                  />
                </div>
              ) : null}
            </div>

            <aside className="flex min-h-0 flex-col bg-white lg:border-l lg:border-[#e5eef4]">
              <div className="shrink-0 border-b border-[#e5eef4] px-4 py-3">
                <h3 className="truncate text-base font-semibold text-[#17324a]">
                  {selected ? selected.title : "Problems"}
                </h3>
              </div>

              {!selected ? (
                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
                  {findingsForSidebar.length === 0 ? (
                    <li className="px-2 py-4 text-base text-[#5a7388]">
                      No static problems in this view.
                    </li>
                  ) : (
                    findingsForSidebar.map((f) => {
                      const page = scan
                        ? relatedPageForFinding(scan, f)
                        : null;
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => openFinding(f)}
                            className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm ${
                              f.severity === "error"
                                ? "border-red-100 bg-red-50 text-red-900"
                                : "border-amber-100 bg-amber-50 text-amber-950"
                            }`}
                          >
                            <div className="font-semibold">{f.title}</div>
                            <div className="mt-1 line-clamp-2 text-[13px] opacity-80">
                              {f.summary}
                            </div>
                            <div className="mt-1.5 font-mono text-xs font-medium opacity-90">
                              {shortFilePath(f.path)}:{f.startLine}
                            </div>
                            {page ? (
                              <div className="mt-0.5 text-xs opacity-70">
                                Page:{" "}
                                {page.title.replace(/^Page\s+/i, "") ||
                                  shortFilePath(page.span.path)}
                              </div>
                            ) : null}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              ) : (
                <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4 text-base">
                  <button
                    type="button"
                    className="text-sm font-medium text-[#64748b] hover:text-[#17324a]"
                    onClick={() => setSelectedFindingId(null)}
                  >
                    ← All problems
                  </button>
                  <div
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase ${
                      selected.severity === "error"
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {selected.severity === "error" ? "Error" : "Warning"}
                  </div>
                  <p className="leading-relaxed text-[#334155]">
                    {selected.summary}
                  </p>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-[#94a3b8]">
                      Where
                    </div>
                    <div className="mt-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 font-mono text-sm text-[#475569]">
                      {shortFilePath(selected.path)}:{selected.startLine}
                      {selected.endLine !== selected.startLine
                        ? `–${selected.endLine}`
                        : ""}
                    </div>
                    {scan && relatedPageForFinding(scan, selected) ? (
                      <button
                        type="button"
                        className="mt-2 text-sm font-medium text-indigo-700 hover:underline"
                        onClick={() => {
                          const page = relatedPageForFinding(scan, selected);
                          if (page) openPage(page.id, selected.id);
                        }}
                      >
                        Show in page flow →
                      </button>
                    ) : null}
                  </div>
                  {selected.snippet ? (
                    <pre className="overflow-x-auto rounded-lg border border-red-100 bg-[#fff8f8] p-3.5 text-[13px] leading-relaxed text-[#7f1d1d]">
                      {selected.snippet}
                    </pre>
                  ) : null}
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-950">
                    <div className="font-semibold">Suggested fix</div>
                    <p className="mt-1.5 leading-relaxed">
                      {selected.suggestedFix}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="default"
                    className="w-full text-sm"
                    onClick={() => copyFinding(selected)}
                  >
                    Copy fix for Cursor
                  </Button>
                </div>
              )}
            </aside>
          </div>

          {detailsOpen ? (
            <div className="absolute inset-0 z-20 flex justify-end bg-black/20">
              <button
                type="button"
                aria-label="Close details"
                className="absolute inset-0 cursor-default"
                onClick={() => setDetailsOpen(false)}
              />
              <aside className="relative flex h-full w-full max-w-md flex-col border-l border-[#e5eef4] bg-white shadow-xl">
                <div className="flex items-center justify-between gap-2 border-b border-[#e5eef4] px-4 py-3.5">
                  <h3 className="text-base font-semibold text-[#17324a]">
                    Scan details
                  </h3>
                  <button
                    type="button"
                    onClick={() => setDetailsOpen(false)}
                    className="rounded-md p-1 text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#475569]"
                    aria-label="Close"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  <div className="grid grid-cols-2 gap-2">
                    <StatCard
                      label="Pages"
                      value={scan.stats.pages}
                      hint={`${scan.stats.components} components · ${scan.fileCount} files`}
                    />
                    <StatCard
                      label="Issues"
                      value={scan.stats.errors}
                      hint="confirmed"
                      tone={scan.stats.errors ? "error" : undefined}
                    />
                    <StatCard
                      label="Healthy"
                      value={countHealthy(scan)}
                      hint={
                        scan.incomplete || scan.findings.length === 0
                          ? "in scanned set only"
                          : "nodes"
                      }
                      tone="ok"
                    />
                    <StatCard
                      label="Suspected"
                      value={scan.stats.warnings}
                      hint="needs review"
                      tone={scan.stats.warnings ? "warn" : undefined}
                    />
                  </div>

                  {scan.warnings.length ? (
                    <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                      {scan.warnings.join(" · ")}
                    </div>
                  ) : null}

                  <div>
                    <p className="text-sm font-semibold text-[#17324a]">
                      What this scan checks
                    </p>
                    <p className="mt-0.5 text-sm text-[#7a93a8]">
                      Static code only
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {scan.checks.map((c) => (
                        <li
                          key={c.id}
                          className="rounded-md bg-[#f8fafc] px-3 py-2.5 text-sm text-[#475569]"
                        >
                          <span className="font-medium text-[#17324a]">
                            {c.label}
                          </span>
                          <span className="text-[#94a3b8]">
                            {" "}
                            · {c.status === "limited" ? "limited" : "on"}
                          </span>
                          <div className="mt-0.5 text-[13px] text-[#7a93a8]">
                            {c.detail}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-sm leading-relaxed text-[#7a93a8]">
                      Not checked: runtime clicks, visual/layout, full
                      axe-core, TypeScript/ESLint, or AI review. Use Live
                      health for browser checks.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "ok" | "error" | "warn";
}) {
  const valueClass =
    tone === "error"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "ok"
          ? "text-emerald-700"
          : "text-[#17324a]";
  return (
    <div className="rounded-xl border border-[#e5eef4] bg-[#fbfcfe] px-3 py-2.5">
      <p className="text-sm font-medium text-[#7a93a8]">{label}</p>
      <p className={`text-2xl font-semibold tracking-tight ${valueClass}`}>
        {value}
      </p>
      <p className="text-xs text-[#94a3b8]">{hint}</p>
    </div>
  );
}
