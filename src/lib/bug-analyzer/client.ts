import type { RepoAnalysis } from "@/lib/bug-analyzer/analyzeRepo";
import type {
  ArchitectureReport,
  LogicalFinding,
} from "@/lib/bug-analyzer/analyzeLogicalGaps";
import type {
  DataIndex,
  FeatureFlow,
  KnowledgeRecord,
  PageSummary,
} from "@/lib/bug-analyzer/buildDataIndex";
import type { DebugDashboardData } from "@/lib/bug-analyzer/debugEvents";
import type { RepoWithStack } from "@/lib/bug-analyzer/detectStack";
import type {
  ErrorExplanation,
  ExplainErrorInput,
} from "@/lib/bug-analyzer/explainError";
import type { LocalRunState } from "@/lib/bug-analyzer/localRun";

export type {
  RepoAnalysis,
  DataIndex,
  FeatureFlow,
  KnowledgeRecord,
  PageSummary,
  ArchitectureReport,
  LogicalFinding,
  RepoWithStack,
  DebugDashboardData,
  ErrorExplanation,
  LocalRunState,
};

export async function fetchDebugDashboard(
  limit = 150,
): Promise<DebugDashboardData> {
  const url = new URL(
    "/api/bug-analyzer/debug-events",
    window.location.origin,
  );
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url.toString(), { cache: "no-store" });
  return (await response.json()) as DebugDashboardData;
}

export async function explainDebugError(
  accessToken: string,
  input: ExplainErrorInput,
): Promise<{ explanation: ErrorExplanation; source: "ai" | "heuristic" }> {
  const response = await fetch("/api/bug-analyzer/explain", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | {
        explanation?: ErrorExplanation;
        source?: "ai" | "heuristic";
        error?: string;
      }
    | null;
  if (!response.ok) {
    throw new Error(body?.error || `Explain failed (${response.status}).`);
  }
  if (!body?.explanation) {
    throw new Error("Explain response missing explanation.");
  }
  return {
    explanation: body.explanation,
    source: body.source ?? "ai",
  };
}

export async function listBugAnalyzerRepos(
  accessToken: string,
  query: string,
  options?: { fresh?: boolean },
): Promise<RepoWithStack[]> {
  const url = new URL("/api/bug-analyzer/repos", window.location.origin);
  if (query.trim()) url.searchParams.set("q", query.trim());
  if (options?.fresh) url.searchParams.set("fresh", "1");
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || `Repo list failed (${response.status}).`);
  }
  const body = (await response.json()) as { repos: RepoWithStack[] };
  return body.repos ?? [];
}

export async function enrichBugAnalyzerRepoStacks(
  accessToken: string,
  fullNames: string[],
): Promise<RepoWithStack[]> {
  if (fullNames.length === 0) return [];
  const response = await fetch("/api/bug-analyzer/repos/stacks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fullNames }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || `Stack label failed (${response.status}).`);
  }
  const body = (await response.json()) as { repos: RepoWithStack[] };
  return body.repos ?? [];
}

export async function probeGithubRepo(
  accessToken: string,
  repo: string,
): Promise<RepoWithStack> {
  const response = await fetch("/api/bug-analyzer/probe", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repo }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    repo?: RepoWithStack;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Probe failed (${response.status}).`);
  }
  if (!body?.repo) throw new Error("Probe response missing repo.");
  return body.repo;
}

export async function analyzeGithubRepo(
  accessToken: string,
  fullName: string,
  ref?: string,
): Promise<RepoAnalysis> {
  const response = await fetch("/api/bug-analyzer/analyze", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fullName, ref }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (RepoAnalysis & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error || `Analyze failed (${response.status}).`);
  }
  return body as RepoAnalysis;
}

export async function startLocalRepoRun(
  accessToken: string,
  fullName: string,
  ref?: string,
): Promise<LocalRunState> {
  const response = await fetch("/api/bug-analyzer/local-run", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fullName, ref, action: "start" }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    run?: LocalRunState;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Local run failed (${response.status}).`);
  }
  if (!body?.run) throw new Error("Local run response missing run state.");
  return body.run;
}

export async function stopLocalRepoRun(
  accessToken: string,
  fullName: string,
): Promise<LocalRunState | null> {
  const response = await fetch("/api/bug-analyzer/local-run", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fullName, action: "stop" }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    run?: LocalRunState | null;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Stop failed (${response.status}).`);
  }
  return body?.run ?? null;
}

export async function fetchLocalRepoRun(
  accessToken: string,
  fullName: string,
): Promise<LocalRunState | null> {
  const url = new URL("/api/bug-analyzer/local-run", window.location.origin);
  url.searchParams.set("fullName", fullName);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    run?: LocalRunState | null;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Status failed (${response.status}).`);
  }
  return body?.run ?? null;
}

export type RepoFileEntry = {
  path: string;
  size: number;
  sha: string;
};

export async function listRepoFiles(
  accessToken: string,
  fullName: string,
  ref?: string,
): Promise<{
  fullName: string;
  ref: string;
  truncated: boolean;
  files: RepoFileEntry[];
}> {
  const response = await fetch("/api/bug-analyzer/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fullName, ref }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    fullName?: string;
    ref?: string;
    truncated?: boolean;
    files?: RepoFileEntry[];
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `File list failed (${response.status}).`);
  }
  return {
    fullName: body?.fullName || fullName,
    ref: body?.ref || ref || "main",
    truncated: Boolean(body?.truncated),
    files: body?.files ?? [],
  };
}

export async function fetchRepoFileContent(
  accessToken: string,
  fullName: string,
  filePath: string,
  ref?: string,
): Promise<{ path: string; content: string }> {
  const response = await fetch("/api/bug-analyzer/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fullName, ref, path: filePath }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    path?: string;
    content?: string;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `File read failed (${response.status}).`);
  }
  if (!body?.content || !body.path) {
    throw new Error("File response missing content.");
  }
  return { path: body.path, content: body.content };
}

export async function buildRepoDataIndex(
  accessToken: string,
  input: {
    fullName: string;
    ref?: string;
    scope: "file" | "repo";
    path?: string | null;
  },
): Promise<DataIndex> {
  const response = await fetch("/api/bug-analyzer/data", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fullName: input.fullName,
      ref: input.ref,
      scope: input.scope,
      path: input.path ?? undefined,
    }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    index?: DataIndex;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Data index failed (${response.status}).`);
  }
  if (!body?.index) {
    throw new Error("Data response missing index.");
  }
  return body.index;
}

export async function fetchLocalRunFile(
  accessToken: string,
  fullName: string,
  filePath: string,
): Promise<{ path: string; content: string; lineCount: number }> {
  const url = new URL(
    "/api/bug-analyzer/local-run/file",
    window.location.origin,
  );
  url.searchParams.set("fullName", fullName);
  url.searchParams.set("path", filePath);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    path?: string;
    content?: string;
    lineCount?: number;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `File read failed (${response.status}).`);
  }
  if (!body?.content || !body.path) {
    throw new Error("File response missing content.");
  }
  return {
    path: body.path,
    content: body.content,
    lineCount: body.lineCount ?? body.content.split("\n").length,
  };
}
