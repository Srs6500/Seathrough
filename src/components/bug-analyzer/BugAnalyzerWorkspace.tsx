"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  FileCode2,
  FolderGit2,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { DataIndexView } from "@/components/bug-analyzer/DataIndexView";
import { InspectCodePanel } from "@/components/bug-analyzer/InspectCodePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import {
  buildRepoDataIndex,
  fetchLocalRepoRun,
  fetchLocalRunFile,
  fetchRepoFileContent,
  listBugAnalyzerRepos,
  listRepoFiles,
  startLocalRepoRun,
  stopLocalRepoRun,
  type DataIndex,
  type LocalRunState,
  type RepoFileEntry,
  type RepoWithStack,
} from "@/lib/bug-analyzer/client";
import {
  fetchGithubStatus,
  startGithubConnect,
  type GithubConnectionStatus,
} from "@/lib/data-flow/client";

type ScopeMode = "file" | "repo";
type WorkspacePhase = "browse" | "run" | "data";

const REPOS_PER_PAGE = 10;

type InspectChainItem = {
  key: string;
  name: string;
  file: string | null;
  line: number | null;
  problem?: { message: string } | null;
};

function statusLabel(status: LocalRunState["status"]): string {
  switch (status) {
    case "cloning":
      return "Downloading from GitHub…";
    case "installing":
      return "Installing dependencies…";
    case "starting":
      return "Starting Next.js…";
    case "ready":
      return "Running";
    case "error":
      return "Failed";
    case "stopped":
      return "Stopped";
    default:
      return status;
  }
}

/** Best-effort Next.js route from a page/route file path. */
function routeFromFilePath(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, "/");

  const appPage = norm.match(
    /(?:^|\/)(?:src\/)?app\/(.+)\/page\.(tsx|ts|jsx|js)$/,
  );
  if (appPage) {
    const segs = appPage[1]!
      .split("/")
      .filter((s) => s && !s.startsWith("(") && !s.endsWith(")"))
      .map((s) => s.replace(/^\[\[\.\.\.(.+)\]\]$/, "*").replace(/^\[(.+)\]$/, ":$1"));
    return "/" + segs.join("/");
  }
  if (/(?:^|\/)(?:src\/)?app\/page\.(tsx|ts|jsx|js)$/.test(norm)) return "/";

  const pagesFile = norm.match(
    /(?:^|\/)(?:src\/)?pages\/(.+)\.(tsx|ts|jsx|js)$/,
  );
  if (pagesFile) {
    let route = pagesFile[1]!;
    if (route === "index") return "/";
    route = route.replace(/\/index$/, "");
    route = route
      .split("/")
      .map((s) => s.replace(/^\[\[\.\.\.(.+)\]\]$/, "*").replace(/^\[(.+)\]$/, ":$1"))
      .join("/");
    return "/" + route;
  }
  return null;
}

export function BugAnalyzerWorkspace() {
  const { accessToken, loading: authLoading } = useAuth();
  const { openAuth } = useQuestionAccess();
  const [status, setStatus] = useState<GithubConnectionStatus | null>(null);
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
  const [phase, setPhase] = useState<WorkspacePhase>("browse");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("file");
  const [files, setFiles] = useState<RepoFileEntry[]>([]);
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const [run, setRun] = useState<LocalRunState | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runFocusPath, setRunFocusPath] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [inspectChain, setInspectChain] = useState<InspectChainItem[]>([]);
  const [inspectLeaf, setInspectLeaf] = useState<InspectChainItem | null>(
    null,
  );
  const [codePath, setCodePath] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [dataIndex, setDataIndex] = useState<DataIndex | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);

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
    void listBugAnalyzerRepos(accessToken, "")
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
    if (!connected) return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [connected]);

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

  useEffect(() => {
    if (!accessToken || !selected || phase !== "run") return;
    const active =
      run?.status === "cloning" ||
      run?.status === "installing" ||
      run?.status === "starting" ||
      run?.status === "ready";
    if (!active && run?.status !== undefined) return;

    let cancelled = false;
    const id = window.setInterval(() => {
      void fetchLocalRepoRun(accessToken, selected.fullName)
        .then((next) => {
          if (!cancelled && next) setRun(next);
        })
        .catch(() => {
          /* ignore */
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [accessToken, selected, phase, run?.status]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as {
        source?: string;
        type?: string;
        chain?: InspectChainItem[];
        leaf?: InspectChainItem;
        note?: string;
      } | null;
      if (!data || data.source !== "seethrough-inspector") return;
      if (data.type === "ready") {
        iframeRef.current?.contentWindow?.postMessage(
          { source: "seethrough-parent", type: "clear-selection" },
          "*",
        );
        return;
      }
      if (data.type !== "inspect") return;
      const chain = data.chain ?? [];
      const leaf = data.leaf ?? chain[0] ?? null;
      setInspectChain(chain);
      setInspectLeaf(leaf);
      setCode(null);
      setCodePath(null);
      setHighlightLine(leaf?.line ?? null);
      setCodeError(data.note ?? null);

      if (!accessToken || !selected || !leaf?.file) {
        if (!leaf?.file && !data.note) {
          setCodeError("No source file on this component.");
        }
        return;
      }

      setCodeLoading(true);
      setCodeError(null);
      void fetchLocalRunFile(accessToken, selected.fullName, leaf.file)
        .then((file) => {
          setCode(file.content);
          setCodePath(file.path);
          setHighlightLine(leaf.line);
        })
        .catch((error: unknown) => {
          setCodeError(
            error instanceof Error ? error.message : "Could not load source.",
          );
        })
        .finally(() => setCodeLoading(false));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [accessToken, selected]);

  const filteredFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, fileQuery]);

  const previewSrc = useMemo(() => {
    if (!run?.previewUrl) return null;
    if (runFocusPath) {
      const route = routeFromFilePath(runFocusPath);
      if (route && !route.includes(":")) {
        return `${run.previewUrl.replace(/\/$/, "")}${route}`;
      }
    }
    return run.previewUrl;
  }, [run?.previewUrl, runFocusPath]);

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

  function currentDataKey(mode: ScopeMode, path: string | null): string {
    return `${mode}:${path || "*"}`;
  }

  async function buildData(mode: ScopeMode, path: string | null = activeFile) {
    if (!accessToken || !selected) {
      openAuth("login");
      return;
    }
    if (mode === "file" && !path) {
      setDataError("Pick a file first, then scan this file.");
      return;
    }

    const key = currentDataKey(mode, mode === "file" ? path : null);
    setDataLoading(true);
    setDataError(null);
    try {
      const next = await buildRepoDataIndex(accessToken, {
        fullName: selected.fullName,
        ref: selected.defaultBranch,
        scope: mode,
        path: mode === "file" ? path : null,
      });
      setDataIndex(next);
      setDataKey(key);
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

  async function openData() {
    if (!selected) return;
    if (scopeMode === "file" && !activeFile) {
      setDataError("Pick a file first, or switch to Entire repo.");
      setPhase("data");
      return;
    }
    setPhase("data");
    const key = currentDataKey(
      scopeMode,
      scopeMode === "file" ? activeFile : null,
    );
    if (dataKey !== key || !dataIndex) {
      await buildData(scopeMode, activeFile);
    }
  }

  async function openRepo(repo: RepoWithStack) {
    if (!accessToken) {
      openAuth("login");
      return;
    }
    setSelected(repo);
    setPhase("browse");
    setScopeMode("file");
    setFiles([]);
    setActiveFile(null);
    setFileContent(null);
    setFileQuery("");
    setFilesError(null);
    setContentError(null);
    setRun(null);
    setRunError(null);
    setRunFocusPath(null);
    setDataIndex(null);
    setDataKey(null);
    setDataError(null);
    setLoadingFiles(true);
    try {
      const next = await listRepoFiles(
        accessToken,
        repo.fullName,
        repo.defaultBranch,
      );
      setFiles(next.files);
      setFilesTruncated(next.truncated);
    } catch (error) {
      setFilesError(
        error instanceof Error ? error.message : "Could not load files.",
      );
    } finally {
      setLoadingFiles(false);
    }
  }

  async function openFile(path: string) {
    if (!accessToken || !selected) return;
    setActiveFile(path);
    setScopeMode("file");
    setLoadingContent(true);
    setContentError(null);
    setFileContent(null);
    try {
      const next = await fetchRepoFileContent(
        accessToken,
        selected.fullName,
        path,
        selected.defaultBranch,
      );
      setFileContent(next.content);
    } catch (error) {
      setContentError(
        error instanceof Error ? error.message : "Could not read file.",
      );
    } finally {
      setLoadingContent(false);
    }
  }

  async function startRun(mode: ScopeMode) {
    if (!accessToken || !selected) {
      openAuth("login");
      return;
    }
    if (mode === "file" && !activeFile) {
      setRunError("Pick a file first, then click Run on this file.");
      return;
    }

    setScopeMode(mode);
    setPhase("run");
    setRunFocusPath(mode === "file" ? activeFile : null);
    setRunError(null);
    setInspectChain([]);
    setInspectLeaf(null);
    setCode(null);
    setCodePath(null);
    setHighlightLine(null);
    setCodeError(null);
    setRun({
      fullName: selected.fullName,
      status: "cloning",
      port: null,
      previewUrl: null,
      error: null,
      dir: null,
      logs: [
        mode === "file"
          ? `Starting local run focused on ${activeFile}…`
          : "Starting local run for entire repo…",
      ],
      updatedAt: new Date().toISOString(),
    });

    try {
      await stopLocalRepoRun(accessToken, selected.fullName).catch(() => null);
      const next = await startLocalRepoRun(
        accessToken,
        selected.fullName,
        selected.defaultBranch,
      );
      setRun(next);
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "Could not start local run.",
      );
    }

    // Build AI data index for this file / entire repo in parallel with the run.
    void buildData(mode, mode === "file" ? activeFile : null);
  }

  async function onStop() {
    if (!accessToken || !selected) return;
    try {
      const next = await stopLocalRepoRun(accessToken, selected.fullName);
      setRun(next);
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "Could not stop run.",
      );
    }
  }

  function resetSelection() {
    setSelected(null);
    setPhase("browse");
    setFiles([]);
    setActiveFile(null);
    setFileContent(null);
    setFileQuery("");
    setFilesError(null);
    setContentError(null);
    setScopeMode("file");
    setRun(null);
    setRunError(null);
    setRunFocusPath(null);
    setInspectChain([]);
    setInspectLeaf(null);
    setCode(null);
    setCodePath(null);
    setHighlightLine(null);
    setCodeError(null);
    setDataIndex(null);
    setDataKey(null);
    setDataError(null);
    setDataLoading(false);
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
            <p className="mt-3 text-sm text-red-700" role="alert">
              GitHub App is not configured on this server.
            </p>
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

  if (selected && phase === "data") {
    return (
      <div className="flex min-h-dvh flex-col bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5eef4] px-4 py-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => {
                setPhase("browse");
                setDataError(null);
              }}
              className="text-sm text-[#2a5f7a] hover:underline"
            >
              ← Files
            </button>
            <p className="mt-1 truncate text-sm font-semibold text-[#17324a]">
              {selected.fullName}
            </p>
            <p className="text-xs text-[#5a7388]">
              Repository Explorer
              {scopeMode === "file" && activeFile
                ? ` · this file · ${activeFile}`
                : " · entire repo"}
              {dataIndex?.features?.length
                ? ` · ${dataIndex.features.length} features`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={dataLoading}
              onClick={() =>
                void buildData(scopeMode, scopeMode === "file" ? activeFile : null)
              }
            >
              {dataLoading ? "Scanning…" : "Scan again"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void startRun(scopeMode)}
              disabled={scopeMode === "file" && !activeFile}
            >
              Run
            </Button>
          </div>
        </header>
        <DataIndexView
          index={dataIndex}
          loading={dataLoading}
          error={dataError}
          onRebuild={() =>
            void buildData(scopeMode, scopeMode === "file" ? activeFile : null)
          }
        />
      </div>
    );
  }

  if (selected && phase === "run") {
    const ready = run?.status === "ready" && Boolean(previewSrc);
    const running =
      run?.status === "cloning" ||
      run?.status === "installing" ||
      run?.status === "starting";

    return (
      <div className="flex min-h-dvh flex-col bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5eef4] px-4 py-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => {
                setPhase("browse");
                setRunError(null);
              }}
              className="text-sm text-[#2a5f7a] hover:underline"
            >
              ← Files
            </button>
            <p className="mt-1 truncate text-sm font-semibold text-[#17324a]">
              {selected.fullName}
            </p>
            <p className="text-xs text-[#5a7388]">
              {runFocusPath
                ? `Run on this file · ${runFocusPath}`
                : "Run on this repo"}
              {" · "}
              {run ? statusLabel(run.status) : "Starting…"}
              {previewSrc ? ` · ${previewSrc}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void openData()}
            >
              <Database className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Data
              {dataLoading
                ? "…"
                : dataIndex?.architecture
                  ? ` · ${dataIndex.architecture.findings.length} issues`
                  : dataIndex?.status === "indexed"
                    ? " · Indexed"
                    : ""}
            </Button>
            {previewSrc ? (
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={previewSrc} target="_blank" rel="noreferrer">
                  Open preview
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </a>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onStop()}
              disabled={!run || run.status === "stopped"}
            >
              Stop
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={running}
              onClick={() =>
                void startRun(runFocusPath ? "file" : "repo")
              }
            >
              Restart
            </Button>
          </div>
        </header>

        {runError ? (
          <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
            {runError}
          </p>
        ) : null}
        {run?.error ? (
          <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
            {run.error}
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="relative flex min-h-[50vh] min-w-0 flex-col bg-[#f4f8fb]">
            <div className="flex items-center gap-1.5 border-b border-[#e5eef4] bg-white px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
              <span className="ml-2 truncate font-mono text-[11px] text-[#7a93a8]">
                {previewSrc ?? "Waiting for local server…"}
              </span>
            </div>
            {ready ? (
              <iframe
                ref={iframeRef}
                key={previewSrc!}
                title={`${selected.fullName} preview`}
                src={previewSrc!}
                className="h-[calc(100dvh-7.5rem)] w-full border-0 bg-white"
              />
            ) : (
              <div className="flex h-[calc(100dvh-7.5rem)] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[#5a7388]">
                <p className="font-medium text-[#17324a]">
                  {run ? statusLabel(run.status) : "Starting…"}
                </p>
                <p>Downloading, installing, then opening a local preview.</p>
              </div>
            )}
            <details className="border-t border-[#e5eef4] bg-white">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#5a7388]">
                Run log
              </summary>
              <pre className="max-h-40 overflow-auto bg-[#0f1c27] p-3 font-mono text-[10px] leading-4 text-[#e8eef3]">
                {(run?.logs ?? []).join("\n") || "No logs yet."}
              </pre>
            </details>
          </div>
          <aside className="min-h-0 min-w-0">
            <InspectCodePanel
              chain={inspectChain}
              leaf={inspectLeaf}
              codePath={codePath}
              code={code}
              highlightLine={highlightLine}
              loading={codeLoading}
              error={codeError}
            />
          </aside>
        </div>
      </div>
    );
  }

  if (selected) {
    const fileRoute = activeFile ? routeFromFilePath(activeFile) : null;

    return (
      <div className="flex min-h-dvh flex-col bg-white">
        <header className="border-b border-[#e5eef4] px-4 py-3">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={resetSelection}
                className="text-sm text-[#2a5f7a] hover:underline"
              >
                ← Repositories
              </button>
              <p className="mt-1 truncate text-sm font-semibold text-[#17324a]">
                {selected.fullName}
              </p>
              <p className="text-xs text-[#5a7388]">
                {selected.defaultBranch}
                {loadingFiles
                  ? " · loading files…"
                  : ` · ${files.length} files`}
                {filesTruncated ? " (truncated)" : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-[#e5eef4] p-0.5">
                <button
                  type="button"
                  onClick={() => setScopeMode("file")}
                  className={
                    scopeMode === "file"
                      ? "rounded-md bg-[#17324a] px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-md px-3 py-1.5 text-xs font-medium text-[#5a7388]"
                  }
                >
                  This file
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode("repo")}
                  className={
                    scopeMode === "repo"
                      ? "rounded-md bg-[#17324a] px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-md px-3 py-1.5 text-xs font-medium text-[#5a7388]"
                  }
                >
                  Entire repo
                </button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void openData()}
              >
                <Database className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Data
                {dataLoading
                  ? "…"
                  : dataIndex?.architecture
                    ? ` · ${dataIndex.architecture.findings.length} issues`
                    : dataIndex?.status === "indexed"
                      ? " · Indexed"
                      : ""}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!activeFile}
                onClick={() => void startRun("file")}
              >
                Run on this file
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void startRun("repo")}
              >
                Run on this repo
              </Button>
            </div>
          </div>
          <p className="text-xs text-[#7a93a8]">
            {scopeMode === "file"
              ? activeFile
                ? `Scope: this file · ${activeFile}${
                    fileRoute ? ` · route ${fileRoute}` : ""
                  } · Run or open Data to scan`
                : "Scope: this file · pick a file, then Run or Data"
              : "Scope: entire repo · Run starts the app; Data builds the AI index"}
          </p>
          {runError ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {runError}
            </p>
          ) : null}
          {dataError && phase === "browse" ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {dataError}
            </p>
          ) : null}
        </header>

        {filesError ? (
          <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
            {filesError}
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-[#e5eef4] lg:border-b-0 lg:border-r">
            <div className="border-b border-[#e5eef4] p-3">
              <Input
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
                placeholder="Filter files…"
                className="h-9 border-[#e5eef4] bg-white text-sm"
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-auto p-2">
              {loadingFiles ? (
                <li className="px-2 py-3 text-sm text-[#5a7388]">Loading…</li>
              ) : filteredFiles.length === 0 ? (
                <li className="px-2 py-3 text-sm text-[#5a7388]">
                  No matching files.
                </li>
              ) : (
                filteredFiles.map((file) => {
                  const active = activeFile === file.path;
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => void openFile(file.path)}
                        className={
                          active
                            ? "flex w-full items-start gap-2 rounded-lg bg-[#17324a] px-2 py-1.5 text-left text-xs text-white"
                            : "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[#17324a] hover:bg-[#f4f8fb]"
                        }
                      >
                        <FileCode2
                          className={
                            active
                              ? "mt-0.5 h-3.5 w-3.5 shrink-0 text-white/80"
                              : "mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7a93a8]"
                          }
                          aria-hidden
                        />
                        <span className="min-w-0 break-all font-mono leading-4">
                          {file.path}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col">
            {scopeMode === "repo" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm font-medium text-[#17324a]">
                  Entire repo selected
                </p>
                <p className="max-w-md text-sm text-[#5a7388]">
                  {files.length} files
                  {filesTruncated ? " (list truncated)" : ""}.{" "}
                  <strong>Data</strong> builds the AI element index;{" "}
                  <strong>Run on this repo</strong> starts the app locally.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openData()}
                  >
                    <Database className="mr-1.5 h-4 w-4" aria-hidden />
                    Data
                  </Button>
                  <Button type="button" onClick={() => void startRun("repo")}>
                    Run on this repo
                  </Button>
                </div>
              </div>
            ) : loadingContent ? (
              <p className="p-6 text-sm text-[#5a7388]">Loading file…</p>
            ) : contentError ? (
              <p className="p-6 text-sm text-red-700">{contentError}</p>
            ) : activeFile && fileContent != null ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5eef4] px-4 py-2">
                  <span className="font-mono text-xs text-[#5a7388]">
                    {activeFile}
                    {fileRoute ? ` · ${fileRoute}` : ""}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void openData()}
                    >
                      <Database className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Data
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void startRun("file")}
                    >
                      Run on this file
                    </Button>
                  </div>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto bg-[#0f1c27] p-4 font-mono text-[11px] leading-5 text-[#e8eef3]">
                  {fileContent}
                </pre>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm font-medium text-[#17324a]">This file</p>
                <p className="max-w-md text-sm text-[#5a7388]">
                  Choose a file on the left, then open <strong>Data</strong> or{" "}
                  <strong>Run on this file</strong>.
                </p>
              </div>
            )}
          </main>
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
            Search by name, owner, or stack.
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
