"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { CodePanel } from "@/components/data-flow/CodePanel";
import { FlowMapCanvas } from "@/components/data-flow/FlowMapCanvas";
import { AccountMenu } from "@/components/lms/AccountMenu";
import { AppHeader } from "@/components/lms/AppHeader";
import { AppShell } from "@/components/lms/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import {
  buildRepoFlowMap,
  fetchGithubStatus,
  startGithubConnect,
  type FlowMapResult,
  type GithubConnectionStatus,
} from "@/lib/data-flow/client";
import type { FlowNode } from "@/lib/data-flow/types";

export function DataFlowWorkspace() {
  const { accessToken, loading: authLoading } = useAuth();
  const { openAuth } = useQuestionAccess();
  const [status, setStatus] = useState<GithubConnectionStatus | null>(null);
  const [repo, setRepo] = useState("");
  const [question, setQuestion] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<FlowMapResult | null>(null);
  const [selected, setSelected] = useState<FlowNode | null>(null);
  const [hideGuesses, setHideGuesses] = useState(false);
  const [hideUnrelated, setHideUnrelated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github")) {
      window.history.replaceState({}, "", "/data-flow");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await fetchGithubStatus(accessToken);
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function runMap(opts?: {
    questionOverride?: string;
    priorNodeIds?: string[];
  }) {
    if (authLoading) return;
    if (!accessToken) {
      openAuth("login");
      return;
    }
    const q = (opts?.questionOverride ?? question).trim();
    if (!repo.trim() || !q) {
      setError("Add a GitHub repo link and a question, then click Show me.");
      return;
    }
    if (status && !status.connected) {
      setError("Connect GitHub first so we can read the repository.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await buildRepoFlowMap(accessToken, {
        repo: repo.trim(),
        question: q,
        priorNodeIds: opts?.priorNodeIds,
      });
      setMap(result);
      setSelected(null);
      if (opts?.questionOverride) setQuestion(q);
    } catch (err) {
      const needConnect =
        err instanceof Error &&
        "needConnect" in err &&
        Boolean((err as { needConnect?: boolean }).needConnect);
      setError(
        err instanceof Error ? err.message : "Could not build the flow map.",
      );
      if (needConnect) {
        // keep error; user can connect
      }
    } finally {
      setBusy(false);
    }
  }

  function onShowMe(event: React.FormEvent) {
    event.preventDefault();
    void runMap();
  }

  function onFollowUp(event: React.FormEvent) {
    event.preventDefault();
    const q = followUp.trim();
    if (!q || !map) return;
    const combined = `${map.question} — follow-up: ${q}`;
    setFollowUp("");
    void runMap({
      questionOverride: combined,
      priorNodeIds: map.nodes.map((n) => n.id),
    });
  }

  function onConnect() {
    if (!accessToken) {
      openAuth("login");
      return;
    }
    startGithubConnect(accessToken);
  }

  const relatedIds = new Set<string>();
  if (hideUnrelated && selected && map) {
    relatedIds.add(selected.id);
    for (const e of map.edges) {
      if (e.from === selected.id) relatedIds.add(e.to);
      if (e.to === selected.id) relatedIds.add(e.from);
    }
  }

  const viewNodes =
    map && hideUnrelated && selected
      ? map.nodes.filter((n) => relatedIds.has(n.id))
      : map?.nodes ?? [];
  const viewEdges =
    map && hideUnrelated && selected
      ? map.edges.filter(
          (e) => relatedIds.has(e.from) && relatedIds.has(e.to),
        )
      : map?.edges ?? [];

  return (
    <AppShell>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader
          current="data-flow"
          account={
            <AccountMenu
              onLogin={() => openAuth("login")}
              onSignup={() => openAuth("signup")}
            />
          }
        />

        {!map ? (
          <main className="flex min-h-0 flex-1 items-center justify-center px-4 py-10">
            <form
              onSubmit={onShowMe}
              className="w-full max-w-xl space-y-4 rounded-2xl border border-[#d7e3eb] bg-white p-6 shadow-sm"
            >
              <div>
                <h1 className="text-xl font-semibold text-[#17324a]">
                  Data flow
                </h1>
                <p className="mt-1 text-sm text-[#5a7388]">
                  Nested Next.js apps, plus React, Express, FastAPI, and Go
                  routes. We read the code (no install/run) and map pages →
                  components → API → database.
                </p>
              </div>

              {!status?.connected ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="mb-2">
                    Connect GitHub so we can read private and installed repos.
                  </p>
                  <Button type="button" size="sm" onClick={onConnect}>
                    Connect GitHub
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-[#5a7388]">
                  GitHub connected
                  {status.slug ? ` · app ${status.slug}` : ""}.
                </p>
              )}

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-[#17324a]">
                  GitHub repo link
                </span>
                <Input
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="https://github.com/org/repo or owner/repo"
                  className="h-11 bg-white"
                  autoFocus
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-[#17324a]">
                  Your question
                </span>
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="How does checkout data get saved?"
                  className="min-h-[96px] resize-y bg-white"
                />
              </label>

              {error ? (
                <p className="text-sm text-red-700" role="alert">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={busy || authLoading}
              >
                {busy ? "Reading repo…" : "Show me"}
              </Button>
            </form>
          </main>
        ) : (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-[#e5eef4] px-4 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMap(null);
                  setSelected(null);
                  setError(null);
                }}
              >
                ← New question
              </Button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#17324a]">
                  {map.fullName}
                </p>
                <p className="truncate text-xs text-[#5a7388]">{map.question}</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-[#5a7388]">
                <input
                  type="checkbox"
                  checked={hideGuesses}
                  onChange={(e) => setHideGuesses(e.target.checked)}
                />
                Hide guesses
              </label>
              <label className="flex items-center gap-1.5 text-xs text-[#5a7388]">
                <input
                  type="checkbox"
                  checked={hideUnrelated}
                  onChange={(e) => setHideUnrelated(e.target.checked)}
                  disabled={!selected}
                />
                Hide unrelated
              </label>
            </div>

            {map.warnings.length > 0 ? (
              <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                {map.warnings.join(" · ")}
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <div className="relative min-h-0 min-w-0 flex-1 bg-[#f4f8fb]">
                {viewNodes.length === 0 ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#5a7388]">
                    No flow nodes to show. Try a more specific question about a
                    page, form, or API route.
                  </div>
                ) : (
                  <FlowMapCanvas
                    nodes={viewNodes}
                    edges={viewEdges}
                    hideGuesses={hideGuesses}
                    focusNodeId={selected?.id ?? null}
                    onSelectNode={setSelected}
                  />
                )}
              </div>
              {selected && accessToken ? (
                <CodePanel
                  accessToken={accessToken}
                  repo={map.fullName}
                  refName={map.ref}
                  span={selected.span}
                  onClose={() => setSelected(null)}
                />
              ) : (
                <aside className="hidden w-72 shrink-0 border-l border-[#d7e3eb] bg-white p-4 text-sm text-[#5a7388] md:block">
                  <p className="font-medium text-[#17324a]">Explore</p>
                  <p className="mt-2">
                    Zoom and drag the map. Click a box to open the matching file
                    and highlighted lines. Dashed amber edges are guesses.
                  </p>
                  <p className="mt-3 text-xs">
                    Scanned {map.fileCount} files
                    {map.truncated ? " (partial)" : ""}.
                  </p>
                </aside>
              )}
            </div>

            <form
              onSubmit={onFollowUp}
              className="flex gap-2 border-t border-[#e5eef4] bg-white px-4 py-3"
            >
              <Input
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder="Follow-up about this flow…"
                className="bg-white"
              />
              <Button type="submit" disabled={busy || !followUp.trim()}>
                Ask
              </Button>
            </form>
          </main>
        )}
      </div>
    </AppShell>
  );
}
