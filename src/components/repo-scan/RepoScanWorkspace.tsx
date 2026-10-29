"use client";

import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  CopyButton,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { AccountMenu } from "@/components/lms/AccountMenu";
import { AppHeader } from "@/components/lms/AppHeader";
import { AppShell } from "@/components/lms/AppShell";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import { FileGraphCanvas } from "@/components/repo-scan/FileGraphCanvas";
import { FilesWorkbench } from "@/components/repo-scan/FilesWorkbench";
import { FeatureNameCard } from "@/components/repo-scan/FeatureVerifyCard";
import { SandboxSettings } from "@/components/repo-scan/SandboxSettings";
import { RepoPicker } from "@/components/repo-scan/RepoPicker";
import {
  enrichBugAnalyzerRepoStacks,
  listBugAnalyzerRepos,
  type RepoWithStack,
} from "@/lib/bug-analyzer/client";
import {
  fetchGithubStatus,
  startGithubConnect,
  type GithubConnectionStatus,
} from "@/lib/data-flow/client";
import { parseGithubRepoWithTreeSitter } from "@/lib/repo-scan/client";
import { readStoredSandbox, type RepoScanSandboxInput } from "@/lib/repo-scan/sandbox";
import { featurePassed } from "@/lib/repo-scan/feature-testing";
import { useScanSession } from "@/lib/repo-scan/session";

export function RepoScanWorkspace() {
  const { accessToken, loading: authLoading } = useAuth();
  const { openAuth } = useQuestionAccess();
  const [status, setStatus] = useState<GithubConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [repoFilter, setRepoFilter] = useState<"all" | "public" | "private">(
    "all",
  );
  const [repos, setRepos] = useState<RepoWithStack[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [reposEpoch, setReposEpoch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const {
    selected,
    parse,
    hydrated,
    beginScan,
    rememberScan,
    resetScan,
  } = useScanSession();
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [view, setView] = useState<"features" | "graph" | "files">("features");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github")) {
      window.history.replaceState({}, "", "/repo-scan");
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

  const repoKey = repos
    .slice(0, 20)
    .map((repo) => repo.id)
    .join(",");

  useEffect(() => {
    if (!accessToken || repos.length === 0) return;
    const names = repos.slice(0, 20).map((repo) => repo.fullName);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, repoKey]);

  function onConnect() {
    if (authLoading) return;
    if (!accessToken) {
      openAuth("login");
      return;
    }
    if (!status?.configured) return;
    if (status.connected) return;
    setBusy(true);
    startGithubConnect(accessToken, "/repo-scan");
  }

  async function scanRepo(
    repo: RepoWithStack,
    sandbox: RepoScanSandboxInput = readStoredSandbox(),
  ) {
    if (!accessToken) {
      openAuth("login");
      return;
    }
    setParseLoading(true);
    setParseError(null);
    try {
      const next = await parseGithubRepoWithTreeSitter(
        accessToken,
        repo.fullName,
        repo.defaultBranch,
        sandbox,
      );
      rememberScan(repo, next);
      setActivePath(next.files[0]?.path ?? null);
    } catch (error) {
      setParseError(
        error instanceof Error
          ? error.message
          : "Could not parse this repository.",
      );
    } finally {
      setParseLoading(false);
    }
  }

  async function openRepo(repo: RepoWithStack) {
    if (!accessToken) {
      openAuth("login");
      return;
    }
    beginScan(repo);
    setParseError(null);
    setActivePath(null);
    setView("features");
  }

  function resetSelection() {
    resetScan();
    setParseError(null);
    setParseLoading(false);
    setActivePath(null);
    setView("features");
  }

  const account = (
    <AccountMenu
      onLogin={() => openAuth("login")}
      onSignup={() => openAuth("signup")}
    />
  );

  if (!connected) {
    const connectDisabled =
      busy || authLoading || Boolean(status && !status.configured);

    return (
      <AppShell>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <AppHeader current="repo-scan" title="Repo-Scan" account={account} />
          <Stack align="center" justify="center" gap="md" flex={1} px="lg">
            <Title order={1} ta="center">
              Connect to GitHub
            </Title>
            <Text c="dimmed" ta="center" maw={420}>
              Connect GitHub, pick a repo, and see what actually works.
            </Text>
            {status && !status.configured ? (
              <Alert color="red" title="GitHub App is not configured on this server.">
                {status.privateKeyError ||
                  "Set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY in your production environment, then redeploy."}
              </Alert>
            ) : null}
            <Button
              size="lg"
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
          </Stack>
        </div>
      </AppShell>
    );
  }

  if (!hydrated) {
    return (
      <AppShell>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f7fafc]">
          <AppHeader current="repo-scan" title="Repo-Scan" account={account} />
          <Group justify="center" align="center" flex={1}>
            <Loader size="sm" />
          </Group>
        </div>
      </AppShell>
    );
  }

  if (selected) {
    const featureList = parse?.catalog?.features ?? [];
    const brokenCount = featureList.filter(
      (feature) => !featurePassed(feature.verification_status),
    ).length;
    const subtitle =
      parseLoading && !parse
        ? "Looking through the repo…"
        : parse
          ? brokenCount === 0
            ? featureList.length === 1
              ? "1 feature"
              : `${featureList.length} features`
            : `${brokenCount} need a look`
          : parseError || "";

    return (
      <AppShell>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f7fafc]">
          <AppHeader current="repo-scan" title="Repo-Scan" account={account} />
          <Group
            gap="sm"
            px="md"
            py="xs"
            wrap="wrap"
            className="border-b border-[#e5eef4] bg-white"
          >
            <ActionIcon
              variant="default"
              onClick={resetSelection}
              aria-label="Back to repositories"
            >
              <ChevronLeft className="size-4" />
            </ActionIcon>
            <div className="min-w-0 flex-1">
              <Text fw={600} size="sm" truncate>
                {selected.fullName}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {subtitle}
              </Text>
            </div>
            <SegmentedControl
              value={view}
              onChange={(value) =>
                setView(value as "features" | "graph" | "files")
              }
              data={[
                { label: "Features", value: "features" },
                { label: "Graph", value: "graph" },
                { label: "Files", value: "files" },
              ]}
            />
            <Button
              variant="default"
              size="sm"
              leftSection={
                parseLoading ? (
                  <Loader size={12} />
                ) : (
                  <RefreshCw className="size-3.5" />
                )
              }
              disabled={parseLoading}
              onClick={() => void scanRepo(selected, readStoredSandbox())}
            >
              {parseLoading ? "Scanning…" : "Scan again"}
            </Button>
          </Group>

          {parseError && !parse ? (
            <Alert color="red" m="lg" role="alert">
              {parseError}
            </Alert>
          ) : null}
          {!parse && !parseLoading ? (
            <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <Stack gap="md" maw={420} mx="auto" pt="xl">
                <SandboxSettings
                  disabled={parseLoading}
                  scanLabel="Scan"
                  onScan={(sandbox) => void scanRepo(selected, sandbox)}
                />
              </Stack>
            </section>
          ) : parseLoading && !parse ? (
            <Group justify="center" align="center" flex={1} gap="sm">
              <Loader size="sm" />
              <Text c="dimmed" size="sm">
                Looking through the repo…
              </Text>
            </Group>
          ) : parse && parse.files.length === 0 ? (
            <Text ta="center" c="dimmed" p="xl">
              No source files were fetched from this repository.
            </Text>
          ) : parse && view === "features" ? (
            <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <Stack gap="md" maw={720} mx="auto">
                <SandboxSettings
                  disabled={parseLoading}
                  scanLabel={parseLoading ? "Scanning…" : "Scan again"}
                  onScan={(sandbox) => void scanRepo(selected, sandbox)}
                />
                {(parse.catalog?.features.length ?? 0) === 0 ? (
                  <Text size="sm" c="dimmed">
                    No features found.
                  </Text>
                ) : (
                  <>
                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                      {parse.catalog?.features.map((feature) => (
                        <FeatureNameCard
                          key={feature.feature_id}
                          feature={feature}
                        />
                      ))}
                    </SimpleGrid>
                  </>
                )}
              </Stack>
            </section>
          ) : parse && view === "graph" ? (
            <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <Stack gap="md" maw={1100} mx="auto">
                <Group justify="space-between">
                  <div>
                    <Title order={3}>How it connects</Title>
                    <Text size="sm" c="dimmed" mt={4}>
                      Click a file to open it.
                    </Text>
                  </div>
                  <CopyButton
                    value={JSON.stringify(
                      parse.catalog ?? parse.graph ?? {},
                      null,
                      2,
                    )}
                  >
                    {({ copied, copy }) => (
                      <Button variant="default" size="sm" onClick={copy}>
                        {copied ? "Copied" : "Copy JSON"}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
                <FileGraphCanvas
                  graph={parse.graph ?? { nodes: [], edges: [] }}
                  onSelectPath={(path) => {
                    setActivePath(path);
                    setView("files");
                  }}
                />
              </Stack>
            </section>
          ) : parse ? (
            <FilesWorkbench
              parse={parse}
              activePath={activePath}
              onSelectPath={setActivePath}
            />
          ) : null}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f7fafc]">
        <AppHeader current="repo-scan" title="Repo-Scan" account={account} />
        <RepoPicker
          query={query}
          onQuery={setQuery}
          repoFilter={repoFilter}
          onFilter={setRepoFilter}
          loading={loadingRepos}
          listError={listError}
          repos={repos}
          onRefresh={() => setReposEpoch((n) => n + 1)}
          onOpen={(repo) => void openRepo(repo)}
          searchRef={searchInputRef}
        />
      </div>
    </AppShell>
  );
}
