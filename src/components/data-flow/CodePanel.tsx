"use client";

import { useEffect, useRef, useState } from "react";
import type { CodeSpan } from "@/lib/data-flow/types";

type Props = {
  accessToken: string;
  repo: string;
  refName: string;
  span: CodeSpan | null;
  onClose: () => void;
};

export function CodePanel({
  accessToken,
  repo,
  refName,
  span,
  onClose,
}: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!span) {
      setContent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL("/api/data-flow/file", window.location.origin);
    url.searchParams.set("repo", repo);
    url.searchParams.set("path", span.path);
    url.searchParams.set("ref", refName);
    void fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          content?: string;
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(body?.error || `Load failed (${response.status})`);
        }
        if (!cancelled) setContent(body?.content ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setContent(null);
          setError(err instanceof Error ? err.message : "Could not load file.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, repo, refName, span?.path]);

  useEffect(() => {
    if (!content || !span) return;
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [content, span?.startLine, span?.path]);

  if (!span) return null;

  const lines = content?.split("\n") ?? [];

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-[#d7e3eb] bg-[#0f1c27] text-[#e8eef3] md:w-[min(42%,28rem)]">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-[#9eb6c8]">
            {span.path}
          </p>
          <p className="text-[11px] text-[#7a93a8]">
            lines {span.startLine}–{span.endLine}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-2 py-1 text-xs text-[#9eb6c8] hover:bg-white/10"
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-4 text-sm text-[#9eb6c8]">Loading file…</p>
        ) : error ? (
          <div className="space-y-2 p-4 text-sm">
            <p className="text-red-300">{error}</p>
            {span.snippet ? (
              <pre className="whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-[11px] text-[#c5d4e0]">
                {span.snippet}
              </pre>
            ) : null}
          </div>
        ) : (
          <pre className="m-0 p-0 font-mono text-[11px] leading-5">
            {lines.map((line, i) => {
              const lineNo = i + 1;
              const active =
                lineNo >= span.startLine && lineNo <= span.endLine;
              return (
                <div
                  key={lineNo}
                  ref={active && lineNo === span.startLine ? highlightRef : null}
                  className={
                    active
                      ? "flex bg-[#2a4a5c]/80"
                      : "flex hover:bg-white/5"
                  }
                >
                  <span className="w-10 shrink-0 select-none pr-2 text-right text-[#5a7388]">
                    {lineNo}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all pr-3 text-[#e8eef3]">
                    {line || " "}
                  </span>
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </aside>
  );
}
