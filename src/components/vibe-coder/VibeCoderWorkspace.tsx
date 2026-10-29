"use client";

import { useEffect, useState } from "react";
import { VibeDatabaseDashboard } from "@/components/vibe-coder/VibeDatabaseDashboard";
import { VibeOnboard } from "@/components/vibe-coder/VibeOnboard";
import { analyzeSchema } from "@/lib/schema-guide/client";
import type { SchemaGuide } from "@/lib/schema-guide/types";
import {
  fetchVibeGithubStatus,
  logoutVibeGithub,
  searchVibeGithubRepos,
  startVibeGithubConnect,
  stopVibePreview,
  type VibeGithubRepo,
} from "@/lib/vibe-coder/client";
import { EMPTY_SANDBOX, sanitizeSandbox } from "@/lib/vibe-coder/sandbox";
import type { VibeSandbox } from "@/lib/vibe-coder/types";

const SCHEMA_KEY = "seethrough.vibe-coder.schema.v2";
const LEGACY_SCHEMA_KEY = "seethrough.vibe-coder.schema.v1";
const REPO_KEY = "seethrough.vibe-coder.repo.v1";
const SANDBOX_KEY = "seethrough.vibe-coder.sandbox.v1";

function persistSchema(guide: SchemaGuide | null, repo: string | null) {
  try {
    if (!guide || !repo) {
      sessionStorage.removeItem(SCHEMA_KEY);
      sessionStorage.removeItem(LEGACY_SCHEMA_KEY);
      sessionStorage.removeItem(REPO_KEY);
      return;
    }
    sessionStorage.setItem(SCHEMA_KEY, JSON.stringify(guide));
    sessionStorage.removeItem(LEGACY_SCHEMA_KEY);
    sessionStorage.setItem(REPO_KEY, repo);
  } catch {
    /* ignore quota */
  }
}

function readSchema(): { guide: SchemaGuide; repo: string } | null {
  try {
    const raw = sessionStorage.getItem(SCHEMA_KEY) ?? sessionStorage.getItem(LEGACY_SCHEMA_KEY);
    const repo = sessionStorage.getItem(REPO_KEY);
    if (!raw || !repo) return null;
    const parsed = JSON.parse(raw) as SchemaGuide;
    if (!parsed || !Array.isArray(parsed.tables)) return null;
    return { guide: parsed, repo };
  } catch {
    return null;
  }
}

export function VibeCoderWorkspace() {
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<VibeGithubRepo[]>([]);
  const [query, setQuery] = useState("");
  const [sandbox, setSandbox] = useState<VibeSandbox>(EMPTY_SANDBOX);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaGuide | null>(null);

  useEffect(() => {
    const stored = readSchema();
    if (stored) {
      setRepoName(stored.repo);
      setSchema(stored.guide);
    }
    try {
      const raw = sessionStorage.getItem(SANDBOX_KEY);
      if (raw) setSandbox(sanitizeSandbox(JSON.parse(raw) as VibeSandbox));
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams(window.location.search);
    const github = params.get("github");
    const reason = params.get("reason");
    if (github === "error") {
      setError(reason || "GitHub authorization failed.");
    } else if (github === "cancelled") {
      setError("GitHub authorization was cancelled.");
    }
    if (github) {
      window.history.replaceState({}, "", "/vibe-coder");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchVibeGithubStatus()
      .then((status) => {
        if (cancelled) return;
        setConnected(Boolean(status.connected));
        setGithubLogin(status.login ?? null);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setConnected(false);
        setGithubLogin(null);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!connected) {
      setRepos([]);
      return;
    }
    let cancelled = false;
    void searchVibeGithubRepos(query)
      .then((next) => {
        if (!cancelled) setRepos(next);
      })
      .catch(() => {
        if (!cancelled) setRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, query]);

  async function openRepo(fullName: string) {
    setBusy(true);
    setError(null);
    setRepoName(fullName);
    const clean = sanitizeSandbox(sandbox);
    try {
      sessionStorage.setItem(SANDBOX_KEY, JSON.stringify(clean));
    } catch {
      /* ignore */
    }
    try {
      const next = await analyzeSchema({ fullName });
      persistSchema(next, fullName);
      setSchema(next);
    } catch (err) {
      persistSchema(null, null);
      setSchema(null);
      setError(err instanceof Error ? err.message : "Could not read that repository.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    const name = repoName;
    persistSchema(null, null);
    setSchema(null);
    setRepoName(null);
    if (name) void stopVibePreview(name).catch(() => {});
    setConnected(false);
    setGithubLogin(null);
    setRepos([]);
    setError(null);
    await logoutVibeGithub();
  }

  function chooseAnother() {
    const name = repoName;
    persistSchema(null, null);
    setSchema(null);
    setRepoName(null);
    setError(null);
    if (name) void stopVibePreview(name).catch(() => {});
  }

  const onboard = !schema && !busy;
  const reading = Boolean(busy && repoName);

  return (
    <div
      id="vibe-root"
      className={`flex flex-col ${
        onboard
          ? "vibe-onboard min-h-dvh"
          : "vibe-dashboard h-dvh overflow-hidden"
      }`}
    >
      <header
        className={`flex h-12 shrink-0 items-center justify-between px-4 ${
          onboard ? "px-6 py-4" : "border-b border-[#ececee] bg-white"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex size-7 items-center justify-center rounded-full ${
              onboard ? "bg-[#111] text-white" : "bg-[#16161a] text-white"
            }`}
          >
            <span className="text-[11px] font-semibold">S</span>
          </span>
          <p className="text-[15px] font-medium text-[#111]">Vibe coder</p>
          {repoName && !onboard ? (
            <>
              <span className="text-[#d4d4d8]">/</span>
              <span className="truncate text-[13px] text-[#71717a]">{repoName}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          {onboard ? (
            <p className="hidden text-[13px] text-[#8a8a93] sm:block">
              Workspace setup{" "}
              <span className="tabular-nums text-[#111]">
                {connected ? "2" : "1"} / 2
              </span>
            </p>
          ) : (
            <button
              type="button"
              className="text-[13px] text-[#71717a]"
              onClick={chooseAnother}
            >
              Another repo
            </button>
          )}
          {connected ? (
            <button
              type="button"
              onClick={() => void handleLogout()}
              className={
                onboard ? "text-[13px] text-[#111]" : "text-[13px] text-[#71717a]"
              }
            >
              Log out
            </button>
          ) : null}
        </div>
      </header>

      {!ready ? (
        <p className="flex-1 px-6 pt-16 text-center text-sm text-[#8a8a93]">
          Checking GitHub…
        </p>
      ) : reading ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <p className="text-[15px] text-[#16161a]">Reading {repoName}…</p>
          <p className="mt-2 max-w-sm text-center text-[13px] text-[#71717a]">
            Starting with the database — schema.prisma and the files that write to
            it.
          </p>
        </div>
      ) : onboard ? (
        <VibeOnboard
          connected={connected}
          githubLogin={githubLogin}
          repos={repos}
          query={query}
          sandbox={sandbox}
          busy={busy}
          error={error}
          onQuery={setQuery}
          onSandbox={setSandbox}
          onConnect={startVibeGithubConnect}
          onOpen={openRepo}
          onLogout={() => void handleLogout()}
        />
      ) : schema && repoName ? (
        <VibeDatabaseDashboard repoName={repoName} guide={schema} />
      ) : null}
    </div>
  );
}
