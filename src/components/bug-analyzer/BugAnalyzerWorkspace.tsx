"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import {
  DataIndexView,
  type DataIndexViewMode,
} from "@/components/bug-analyzer/DataIndexView";
import { FrontendArchitecturePanel } from "@/components/bug-analyzer/FrontendArchitecturePanel";
import {
  XRayPanel,
  type XRayExploreTarget,
} from "@/components/bug-analyzer/XRayPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import {
  buildRepoDataIndex,
  enrichBugAnalyzerRepoStacks,
  listBugAnalyzerRepos,
  type DataIndex,
  type RepoWithStack,
} from "@/lib/bug-analyzer/client";
import {
  fetchGithubStatus,
  startGithubConnect,
  type GithubConnectionStatus,
} from "@/lib/data-flow/client";

const REPOS_PER_PAGE = 10;

type DebuggerTab = "features" | "frontend" | "backend";

export function BugAnalyzerWorkspace() {
  const { accessToken, loading: authLoading } = useAuth();
  const { openAuth, beginQuestion, cancelQuestion } = useQuestionAccess();
  const [status, setStatus] = useState<GithubConnectionStatus | null>(null);
  const [debuggerTab, setDebuggerTab] = useState<DebuggerTab>("features");
  const [backendFocus, setBackendFocus] = useState<{
    findingId: string;
    token: number;
  } | null>(null);
  const [frontendFocus, setFrontendFocus] = useState<{
    pagePath?: string;
    findingId?: string;
    token: number;
  } | null>(null);
  const [backendMode, setBackendMode] =
    useState<DataIndexViewMode>("analyzer");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [repoFilter, setRepoFilter] = useState<"all" | "public" | "private">(
    "all",
  );
  const [repoPage, setRepoPage] = useState(0);
  const [repos, setRepos] = useState<RepoWithStack[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [reposEpoch, setReposEpoch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [selected, setSelected] = useState<RepoWithStack | null>(null);
  const [dataIndex, setDataIndex] = useState<DataIndex | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github")) {
      window.history.replaceState({}, "", "/bug-analyzer");
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

  const connected = Boolean(status?.connected);

  useEffect(() => {
    if (!accessToken || !connected) {
      setRepos([]);
      setListError(null);
      return;
    }

    let cancelled = false;
    setLoadingRepos(true);
    setListError(null);
    void listBugAnalyzerRepos(accessToken, "", {
      fresh: reposEpoch > 0,
    })
      .then((next) => {
        if (!cancelled) setRepos(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRepos([]);
          setListError(
            error instanceof Error
              ? error.message
              : "Could not load repositories.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRepos(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, connected, reposEpoch]);

  useEffect(() => {
    if (!connected || selected) return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [connected, selected]);

  const filteredRepos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos.filter((repo) => {
      if (repoFilter === "public" && repo.private) return false;
      if (repoFilter === "private" && !repo.private) return false;
      if (!q) return true;
      const full = repo.fullName.toLowerCase();
      const name = repo.name.toLowerCase();
      const stack = repo.stackLabel.toLowerCase();
      return full.includes(q) || name.includes(q) || stack.includes(q);
    });
  }, [repos, query, repoFilter]);

  const repoPageCount = Math.max(
    1,
    Math.ceil(filteredRepos.length / REPOS_PER_PAGE),
  );
  const safeRepoPage = Math.min(repoPage, repoPageCount - 1);
  const pagedRepos = useMemo(() => {
    const start = safeRepoPage * REPOS_PER_PAGE;
    return filteredRepos.slice(start, start + REPOS_PER_PAGE);
  }, [filteredRepos, safeRepoPage]);

  useEffect(() => {
    setRepoPage(0);
  }, [query, repoFilter]);

  const pageKey = pagedRepos.map((repo) => repo.id).join(",");

  useEffect(() => {
    if (!accessToken || pagedRepos.length === 0) return;
    const names = pagedRepos.map((repo) => repo.fullName);
    let cancelled = false;
    void enrichBugAnalyzerRepoStacks(accessToken, names)
      .then((labeled) => {
        if (cancelled || labeled.length === 0) return;
        const byId = new Map(labeled.map((repo) => [repo.id, repo]));
        setRepos((current) =>
          current.map((repo) => {
            const next = byId.get(repo.id);
            if (!next) return repo;
            if (
              next.stackLabel === repo.stackLabel &&
              next.badge === repo.badge
            ) {
              return repo;
            }
            return { ...repo, stackLabel: next.stackLabel, badge: next.badge };
          }),
        );
      })
      .catch(() => {
        // Keep language labels if the cheap stack pass fails.
      });
    return () => {
      cancelled = true;
    };
    // pageKey is the visible set; labels update in place without retriggering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, pageKey]);

  function onConnect() {
    if (authLoading) return;
    if (!accessToken) {
      openAuth("login");
      return;
    }
    if (!status?.configured) return;
    if (status.connected) return;
    setBusy(true);
    startGithubConnect(accessToken, "/bug-analyzer");
  }

  async function buildData(repo: RepoWithStack) {
    if (!accessToken) {
      openAuth("login");
      return;
    }
    setDataLoading(true);
    setDataError(null);
    try {
      const next = await buildRepoDataIndex(accessToken, {
        fullName: repo.fullName,
        ref: repo.defaultBranch,
        scope: "repo",
        path: null,
      });
      setDataIndex(next);
    } catch (error) {
      setDataError(
        error instanceof Error
          ? error.message
          : "Could not build data index.",
      );
    } finally {
      setDataLoading(false);
    }
  }

  async function openRepo(repo: RepoWithStack) {
    if (!accessToken) {
      openAuth("login");
      return;
    }
    setSelected(repo);
    setDataIndex(null);
    setDataError(null);
    setDataLoading(true);
    await buildData(repo);
  }

  function resetSelection() {
    setSelected(null);
    setDataIndex(null);
    setDataError(null);
    setDataLoading(false);
    setBackendFocus(null);
    setFrontendFocus(null);
    setDebuggerTab("features");
  }

  function exploreFeature(target: XRayExploreTarget) {
    const token = Date.now();
    if (target.tab === "frontend") {
      setFrontendFocus({
        pagePath: target.pagePath,
        findingId: target.findingId,
        token,
      });
      setDebuggerTab("frontend");
      return;
    }
    if (target.findingId) {
      setBackendFocus({ findingId: target.findingId, token });
    }
    setBackendMode("analyzer");
    setDebuggerTab("backend");
  }

  if (!connected) {
    const connectDisabled =
      busy || authLoading || Boolean(status && !status.configured);

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-white px-6">
        <div className="flex w-full max-w-lg flex-col items-center text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-[#17324a] sm:text-5xl">
            Connect to GitHub
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[#5a7388]">
            Link your GitHub account to pick a repository and start debugging.
          </p>
          {status && !status.configured ? (
            <div
              className="mt-4 max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800"
              role="alert"
            >
              <p className="font-semibold">
                GitHub App is not configured on this server.
              </p>
              <p className="mt-1.5 leading-relaxed text-red-700/90">
                {status.privateKeyError ||
                  "Set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY in your production environment, then redeploy."}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-red-700/80">
                On Vercel, paste the full private key PEM (not a local{" "}
                <code className="rounded bg-red-100 px-1">.pem</code> file
                path). Use Production env, then Redeploy.
              </p>
            </div>
          ) : null}
          <Button
            type="button"
            size="lg"
            className="mt-8 h-12 min-w-[12rem] px-8 text-base font-semibold"
            disabled={connectDisabled}
            onClick={onConnect}
          >
            {busy
              ? "Opening GitHub…"
              : authLoading
                ? "Loading…"
                : !accessToken
                  ? "Sign in to continue"
                  : "Connect GitHub"}
          </Button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-[#f7fafc]">
        <header className="z-20 shrink-0 border-b border-[#e5eef4] bg-white">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
            <button
              type="button"
              onClick={resetSelection}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#e5eef4] bg-white text-[#17324a] transition hover:bg-[#f4f8fb]"
              aria-label="Back to repositories"
            >
              <ChevronLeft className="size-4" />
            </button>

            <div
              className="flex rounded-lg border border-[#e5eef4] bg-[#f7fafc] p-0.5"
              role="group"
              aria-label="Debugger view"
            >
              {(
                [
                  ["features", "Features"],
                  ["frontend", "Frontend"],
                  ["backend", "Backend"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDebuggerTab(id)}
                  className={
                    debuggerTab === id
                      ? "rounded-md bg-[#17324a] px-3 py-1.5 text-sm font-medium text-white"
                      : "rounded-md px-3 py-1.5 text-sm font-medium text-[#5a7388]"
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {debuggerTab === "features" ? (
              <p className="min-w-0 truncate text-sm text-[#7a93a8]">
                {dataLoading && !dataIndex
                  ? "Scanning entire repository…"
                  : dataIndex?.status === "partial"
                    ? "Partial inventory"
                    : dataIndex?.features?.length
                      ? `${dataIndex.features.length} features`
                      : "Feature cards"}
              </p>
            ) : null}

            {debuggerTab === "backend" ? (
              <>
                {dataIndex ? (
                  <div
                    className="flex rounded-lg border border-[#e5eef4] bg-[#f7fafc] p-0.5"
                    role="group"
                    aria-label="Backend mode"
                  >
                    <button
                      type="button"
                      onClick={() => setBackendMode("analyzer")}
                      disabled={!dataIndex.architecture}
                      className={
                        backendMode === "analyzer"
                          ? "rounded-md bg-[#e8f1ff] px-3 py-1.5 text-sm font-medium text-[#17324a] disabled:opacity-40"
                          : "rounded-md px-3 py-1.5 text-sm font-medium text-[#5a7388] disabled:opacity-40"
                      }
                    >
                      Analyzer
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackendMode("explorer")}
                      className={
                        backendMode === "explorer"
                          ? "rounded-md bg-[#e8f1ff] px-3 py-1.5 text-sm font-medium text-[#17324a]"
                          : "rounded-md px-3 py-1.5 text-sm font-medium text-[#5a7388]"
                      }
                    >
                      Explorer
                    </button>
                  </div>
                ) : null}
                <p className="min-w-0 truncate text-sm text-[#7a93a8]">
                  {dataLoading && !dataIndex
                    ? "Scanning entire repository…"
                    : [
                        dataIndex?.features?.length
                          ? `${dataIndex.features.length} features`
                          : null,
                        dataIndex?.architecture?.findings.length
                          ? `${dataIndex.architecture.findings.length} issues`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Static analysis"}
                </p>
              </>
            ) : null}

            <div className="min-w-0 flex-1" />

            {debuggerTab === "backend" || debuggerTab === "features" ? (
              <button
                type="button"
                onClick={() => selected && void buildData(selected)}
                disabled={dataLoading || !selected}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#e5eef4] bg-white px-3 text-sm font-semibold text-[#17324a] transition hover:bg-[#f4f8fb] disabled:opacity-50"
              >
                {dataLoading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden />
                )}
                {dataLoading ? "Scanning…" : "Scan again"}
              </button>
            ) : null}
          </div>
        </header>

        {/* Keep panels mounted so switching tabs does not remount or rescan */}
        <div
          className={
            debuggerTab === "features"
              ? "flex min-h-0 flex-1 flex-col"
              : "hidden"
          }
        >
          <XRayPanel
            accessToken={accessToken}
            onNeedAuth={() => openAuth("login")}
            beginQuestion={beginQuestion}
            cancelQuestion={cancelQuestion}
            index={dataIndex}
            loading={dataLoading}
            error={dataError}
            fullName={selected.fullName}
            defaultBranch={selected.defaultBranch}
            onRebuild={() => void buildData(selected)}
            onExplore={exploreFeature}
          />
        </div>
        <div
          className={
            debuggerTab === "frontend"
              ? "flex min-h-0 flex-1 flex-col"
              : "hidden"
          }
        >
          <FrontendArchitecturePanel
            accessToken={accessToken}
            onNeedAuth={() => openAuth("login")}
            fullName={selected.fullName}
            defaultBranch={selected.defaultBranch}
            focusRequest={frontendFocus}
          />
        </div>
        <div
          className={
            debuggerTab === "backend"
              ? "flex h-0 min-h-0 flex-1 flex-col overflow-hidden"
              : "hidden"
          }
        >
          <DataIndexView
            index={dataIndex}
            loading={dataLoading}
            error={dataError}
            repoFullName={selected.fullName}
            onRebuild={() => void buildData(selected)}
            embedded
            mode={backendMode}
            onModeChange={setBackendMode}
            focusRequest={backendFocus}
          />
        </div>
      </div>
    );
  }

  const filterOptions = [
    { id: "all" as const, label: "All" },
    { id: "public" as const, label: "Public" },
    { id: "private" as const, label: "Private" },
  ];

  function openFirstMatch() {
    const first = pagedRepos[0] ?? filteredRepos[0];
    if (first) void openRepo(first);
  }

  const pageStart =
    filteredRepos.length === 0 ? 0 : safeRepoPage * REPOS_PER_PAGE + 1;
  const pageEnd = Math.min(
    (safeRepoPage + 1) * REPOS_PER_PAGE,
    filteredRepos.length,
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#f7fafc]">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-5 pt-6 pb-5 sm:px-6 sm:pt-8">
        <header className="shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight text-[#17324a] sm:text-[1.75rem]">
            Find a repository
          </h1>
          <p className="mt-1 text-sm text-[#5a7388]">
            Search by name, owner, or stack — pick one to scan the whole repo.
          </p>

          <div className="relative mt-4">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#7a93a8]"
              aria-hidden
            />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  openFirstMatch();
                }
              }}
              placeholder="Search repositories…"
              aria-label="Search repositories"
              className="h-11 rounded-xl border-[#d7e3ec] bg-white pr-11 pl-10 text-[15px] shadow-sm placeholder:text-[#9aafc0] focus-visible:border-[#2a5f7a] focus-visible:ring-[#2a5f7a]/20"
            />
            {loadingRepos ? (
              <Loader2
                className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-[#2a5f7a]"
                aria-label="Loading repositories"
              />
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Filter repositories"
            >
              {filterOptions.map((option) => {
                const active = repoFilter === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setRepoFilter(option.id)}
                    className={
                      active
                        ? "rounded-lg bg-[#17324a] px-2.5 py-1 text-sm font-medium text-white"
                        : "rounded-lg px-2.5 py-1 text-sm font-medium text-[#5a7388] hover:bg-white hover:text-[#17324a]"
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-[#7a93a8]" aria-live="polite">
                {loadingRepos
                  ? "Loading…"
                  : filteredRepos.length === 0
                    ? "0 repos"
                    : `${pageStart}–${pageEnd} of ${filteredRepos.length}`}
              </p>
              <button
                type="button"
                onClick={() => setReposEpoch((n) => n + 1)}
                disabled={loadingRepos}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2a5f7a] hover:underline disabled:opacity-50"
              >
                <RefreshCw
                  className={`size-3.5 ${loadingRepos ? "animate-spin" : ""}`}
                  aria-hidden
                />
                Refresh
              </button>
            </div>
          </div>

          {listError ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {listError}
            </p>
          ) : null}
        </header>

        <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-xl border border-[#d7e3ec] bg-white shadow-sm">
          {loadingRepos && repos.length === 0 ? (
            <ul className="divide-y divide-[#eef3f7]" aria-busy="true">
              {Array.from({ length: REPOS_PER_PAGE }).map((_, index) => (
                <li key={index} className="flex items-center gap-3 px-4 py-3">
                  <span className="size-8 shrink-0 animate-pulse rounded-lg bg-[#e8eef4]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3.5 w-1/3 animate-pulse rounded bg-[#e8eef4]" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-[#eef3f7]" />
                  </div>
                </li>
              ))}
            </ul>
          ) : pagedRepos.length > 0 ? (
            <ul className="h-full divide-y divide-[#eef3f7] overflow-y-auto">
              {pagedRepos.map((repo) => (
                <li key={repo.id}>
                  <button
                    type="button"
                    onClick={() => void openRepo(repo)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#f4f8fb] focus-visible:bg-[#f4f8fb] focus-visible:outline-none"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#eef5f9] text-[#2a5f7a]">
                      <FolderGit2 className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#17324a]">
                        {repo.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[#7a93a8]">
                        {repo.fullName}
                        <span className="text-[#b0c0ce]"> · </span>
                        {repo.stackLabel}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-[#7a93a8]">
                      {repo.private ? "Private" : "Public"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 py-14 text-center">
              <p className="text-sm font-medium text-[#17324a]">
                {query.trim() || repoFilter !== "all"
                  ? "No repositories match"
                  : "No repositories available"}
              </p>
              <p className="mt-1 text-sm text-[#5a7388]">
                {query.trim() || repoFilter !== "all"
                  ? "Try another search or filter."
                  : "Install the GitHub App on the repos you want to debug."}
              </p>
            </div>
          )}
        </div>

        <footer className="mt-3 flex shrink-0 items-center justify-between gap-3">
          <p className="text-xs text-[#9aafc0]">
            {loadingRepos && repos.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[#5a7388]">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Updating…
              </span>
            ) : (
              "10 per page"
            )}
          </p>
          {filteredRepos.length > REPOS_PER_PAGE ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRepoPage((p) => Math.max(0, p - 1))}
                disabled={safeRepoPage === 0}
                className="inline-flex size-8 items-center justify-center rounded-lg border border-[#d7e3ec] bg-white text-[#17324a] transition hover:bg-[#f4f8fb] disabled:opacity-35"
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </button>
              <p className="min-w-20 text-center text-sm text-[#5a7388]">
                {safeRepoPage + 1} / {repoPageCount}
              </p>
              <button
                type="button"
                onClick={() =>
                  setRepoPage((p) => Math.min(repoPageCount - 1, p + 1))
                }
                disabled={safeRepoPage >= repoPageCount - 1}
                className="inline-flex size-8 items-center justify-center rounded-lg border border-[#d7e3ec] bg-white text-[#17324a] transition hover:bg-[#f4f8fb] disabled:opacity-35"
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          ) : (
            <span />
          )}
        </footer>
      </div>
    </div>
  );
}
