"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runFrontendHealthScan } from "@/lib/frontend-health/client";
import { normalizeScanTargetUrl } from "@/lib/frontend-health/targetUrl";
import type {
  FrontendFinding,
  FrontendScanResult,
} from "@/lib/frontend-health/types";
import { toUserFacingError } from "@/lib/errors/userFacing";

type Props = {
  accessToken: string | null;
  onNeedAuth: () => void;
  /** Selected repo label for the header copy (scan still uses demo/live URL). */
  repoLabel?: string;
};

const SEVERITY_STROKE: Record<string, string> = {
  error: "#dc2626",
  warning: "#d97706",
  info: "#64748b",
};

export function FrontendHealthPanel({
  accessToken,
  onNeedAuth,
  repoLabel,
}: Props) {
  const [targetUrl, setTargetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<FrontendScanResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Switching GitHub repos must not keep the previous screenshot/findings.
  useEffect(() => {
    setScan(null);
    setSelectedId(null);
    setError(null);
    setTargetUrl("");
  }, [repoLabel]);

  const selected = useMemo(
    () => scan?.findings.find((f) => f.id === selectedId) ?? null,
    [scan, selectedId],
  );

  async function runScan(useFixture: boolean) {
    if (!accessToken) {
      onNeedAuth();
      return;
    }

    let liveUrl: string | undefined;
    if (!useFixture) {
      const normalized = normalizeScanTargetUrl(targetUrl);
      if (!normalized.ok) {
        setError(normalized.error);
        return;
      }
      liveUrl = normalized.url;
      setTargetUrl(liveUrl);
    }

    setBusy(true);
    setError(null);
    try {
      const result = await runFrontendHealthScan(accessToken, {
        useFixture,
        ...(liveUrl ? { targetUrl: liveUrl } : {}),
      });
      setScan(result);
      setSelectedId(result.findings[0]?.id ?? null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Frontend scan failed.";
      // Prefer API’s already-friendly message; avoid Zod JSON dumps.
      if (message.includes('"code"') && message.includes("targetUrl")) {
        setError(
          "Enter a full http(s) app URL, or use Scan demo. A GitHub repo name is not enough.",
        );
      } else {
        setError(toUserFacingError(err, "Frontend scan failed."));
      }
    } finally {
      setBusy(false);
    }
  }

  function copyFindings() {
    if (!scan) return;
    const text = scan.findings
      .map(
        (f) =>
          `- [${f.severity}] ${f.title}: ${f.summary}` +
          (f.source_file
            ? ` (${f.source_file}${f.source_line ? `:${f.source_line}` : ""})`
            : "") +
          `\n  Fix: ${f.suggested_fix}` +
          (f.evidence.error ? `\n  Error: ${f.evidence.error}` : ""),
      )
      .join("\n\n");
    void navigator.clipboard.writeText(text);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e5eef4] px-3 py-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#7a93a8]">
            {scan
              ? scan.mode === "fixture"
                ? `${scan.findings.length} findings · demo`
                : `${scan.findings.length} findings · ${scan.targetUrl}`
              : repoLabel || "Live health"}
          </p>
        </div>
        <Input
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="http://localhost:3000"
          className="h-9 w-full max-w-xs bg-white text-sm"
          disabled={busy}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !targetUrl.trim()}
          onClick={() => void runScan(false)}
        >
          {busy ? "Scanning…" : "Scan URL"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void runScan(true)}
        >
          Try demo
        </Button>
      </div>

      {error ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {scan?.mode === "fixture" ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
          Showing the built-in <strong>Acme Studio</strong> demo — not{" "}
          {repoLabel ? <strong>{repoLabel}</strong> : "your repository"}. To
          scan your app, put its running URL in the box and click{" "}
          <strong>Scan URL</strong>.
        </div>
      ) : null}

      {!scan ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium text-[#17324a]">
            Application Health — Frontend
          </p>
          <p className="max-w-md text-sm text-[#5a7388]">
            {repoLabel ? (
              <>
                <span className="font-medium text-[#17324a]">{repoLabel}</span>{" "}
                is selected for context only. This tab opens a real browser
                against a live URL — it does not crawl the GitHub repo. Run the
                Careers app locally (or deploy it), paste that URL, then Scan
                URL.
              </>
            ) : (
              <>
                Paste a running app URL and click Scan URL. Or try the built-in
                broken demo to see how findings look.
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              disabled={busy || !targetUrl.trim()}
              onClick={() => void runScan(false)}
            >
              Scan URL
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void runScan(true)}
            >
              Try built-in demo
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.85fr)]">
          <div className="relative min-h-0 overflow-y-auto bg-[#e8eef3] p-3">
            <div className="relative mx-auto max-w-[1280px] overflow-hidden rounded-xl border border-[#d7e3eb] bg-white shadow-sm">
              {scan.screenshotBase64 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/png;base64,${scan.screenshotBase64}`}
                  alt="Scanned page preview"
                  className="block w-full"
                  width={scan.viewport.width}
                  height={scan.viewport.height}
                />
              ) : (
                <div className="flex h-80 items-center justify-center text-sm text-[#5a7388]">
                  No screenshot captured
                </div>
              )}
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${scan.viewport.width} ${scan.viewport.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {scan.findings.map((f) =>
                  f.rect ? (
                    <rect
                      key={f.id}
                      x={f.rect.x}
                      y={f.rect.y}
                      width={f.rect.width}
                      height={f.rect.height}
                      fill="transparent"
                      stroke={
                        selectedId === f.id
                          ? "#0f172a"
                          : SEVERITY_STROKE[f.severity] || "#64748b"
                      }
                      strokeWidth={selectedId === f.id ? 3 : 2}
                      rx={4}
                      className="pointer-events-auto cursor-pointer"
                      onClick={() => setSelectedId(f.id)}
                    />
                  ) : null,
                )}
              </svg>
            </div>
            <p className="mt-2 text-center text-xs text-[#94a3b8]">
              {scan.mode === "fixture"
                ? "Built-in Acme Studio demo · not your repository"
                : [
                    scan.screenshotFullPage ? "Full-page capture" : "Viewport capture",
                    scan.pagesScanned?.length
                      ? `${scan.pagesScanned.length} route${scan.pagesScanned.length === 1 ? "" : "s"}: ${scan.pagesScanned.join(", ")}`
                      : scan.targetUrl,
                  ].join(" · ")}
            </p>
          </div>

          <aside className="flex min-h-0 flex-col border-l border-[#d7e3eb] bg-white">
            <div className="flex shrink-0 items-center justify-between border-b border-[#e5eef4] px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-[#17324a]">
                  Detected problems
                </h3>
                <p className="text-sm text-[#5a7388]">
                  {scan.findings.length} findings · {scan.title}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={copyFindings}
                disabled={!scan.findings.length}
              >
                Copy for Cursor
              </Button>
            </div>

            <ul className="shrink-0 space-y-1 border-b border-[#e5eef4] px-3 py-2 text-sm">
              {scan.checks.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-[#475569]">{c.label}</span>
                  <span
                    className={
                      c.status === "failed"
                        ? "font-medium text-red-700"
                        : c.status === "skipped"
                          ? "text-[#94a3b8]"
                          : "font-medium text-emerald-700"
                    }
                  >
                    {c.status}
                  </span>
                </li>
              ))}
            </ul>

            {scan.findings.length === 0 ? (
              <div className="shrink-0 border-b border-[#e5eef4] p-4">
                <p className="text-sm text-[#334155]">
                  No findings on this page for the six checks above. Try a page
                  with forms/broken links, or Try demo.
                </p>
              </div>
            ) : (
              <ul className="max-h-40 shrink-0 space-y-1 overflow-y-auto border-b border-[#e5eef4] p-2">
                {scan.findings.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(f.id)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                        selectedId === f.id
                          ? "border-slate-400 bg-[#e8f1ff] ring-1 ring-slate-300"
                          : "border-transparent hover:bg-[#f8fafc]"
                      }`}
                    >
                      <div className="font-semibold text-[#0f172a]">
                        {f.title}
                      </div>
                      <div className="mt-0.5 text-[#5a7388]">{f.summary}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selected ? (
                <FindingDetail finding={selected} />
              ) : scan.findings.length === 0 ? (
                <p className="text-base text-[#5a7388]">
                  Tip: scan a page with forms/broken links (or Try demo) to see
                  findings. Careers-Page-ATS must be running on its own URL/port —
                  not SeeThrough on :3000.
                </p>
              ) : (
                <p className="text-base text-[#5a7388]">
                  Click a highlight or finding to see evidence and a suggested
                  fix.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function FindingDetail({ finding }: { finding: FrontendFinding }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">
          {finding.issue_type.replace(/_/g, " ")} · {finding.severity} ·{" "}
          {finding.verification}
        </div>
        <h4 className="mt-1 font-semibold text-[#17324a]">{finding.title}</h4>
        <p className="mt-1 text-[#334155]">{finding.summary}</p>
      </div>

      {finding.source_file ? (
        <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 font-mono text-xs text-[#475569]">
          {finding.source_file}
          {finding.source_line ? `:${finding.source_line}` : ""}
          {finding.component ? ` · ${finding.component}` : ""}
        </div>
      ) : (
        <p className="text-xs text-[#94a3b8]">
          Source unknown — no stack trace / source map / instrumentation.
        </p>
      )}

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
          Evidence
        </div>
        <ul className="mt-1 space-y-1 text-xs text-[#475569]">
          {finding.evidence.action ? (
            <li>Action: {finding.evidence.action}</li>
          ) : null}
          {finding.evidence.error ? (
            <li className="text-red-700">Error: {finding.evidence.error}</li>
          ) : null}
          {finding.evidence.request_status != null ? (
            <li>HTTP: {finding.evidence.request_status}</li>
          ) : null}
          {finding.evidence.request_url ? (
            <li>URL: {finding.evidence.request_url}</li>
          ) : null}
          {finding.evidence.notes ? <li>{finding.evidence.notes}</li> : null}
        </ul>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
        <div className="font-semibold">Suggested fix</div>
        <p className="mt-1">{finding.suggested_fix}</p>
      </div>
    </div>
  );
}
