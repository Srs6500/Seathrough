import type { LocalRunState } from "@/lib/bug-analyzer/localRun";
import type {
  VibeAskResult,
  VibeGuide,
  VibeSandbox,
} from "@/lib/vibe-coder/types";

export type VibeSourcePage = {
  route: string;
  name: string;
  file: string;
  auth: boolean;
};

export type VibePreviewRun = LocalRunState;

export type VibePreviewStatus = {
  enabled: boolean;
  run: VibePreviewRun | null;
};

const ACTIVE_PREVIEW = new Set(["cloning", "installing", "starting", "ready"]);

export type VibeGithubStatus = {
  configured: boolean;
  connected: boolean;
  login: string | null;
  slug: string | null;
  privateKeyError: string | null;
};

export type VibeGithubRepo = {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export async function fetchVibeGithubStatus(): Promise<VibeGithubStatus> {
  const response = await fetch("/api/vibe-coder/github/status", {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`GitHub status failed (${response.status}).`);
  }
  return (await response.json()) as VibeGithubStatus;
}

export function startVibeGithubConnect(): void {
  window.location.href = "/api/vibe-coder/github/connect";
}

export async function searchVibeGithubRepos(query: string): Promise<VibeGithubRepo[]> {
  const url = new URL("/api/vibe-coder/github/repos", window.location.origin);
  if (query.trim()) url.searchParams.set("q", query.trim());
  const response = await fetch(url.toString(), {
    cache: "no-store",
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    repos?: VibeGithubRepo[];
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Repo search failed (${response.status}).`);
  }
  return body?.repos ?? [];
}

export async function logoutVibeGithub(): Promise<void> {
  await fetch("/api/vibe-coder/github/logout", {
    method: "POST",
    credentials: "include",
  });
}

export async function scanVibeRepo(
  fullName: string,
  sandbox?: VibeSandbox,
): Promise<VibeGuide> {
  const response = await fetch("/api/vibe-coder/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ fullName, sandbox }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    guide?: VibeGuide;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Scan failed (${response.status}).`);
  }
  if (!body?.guide) {
    throw new Error("Scan finished without a guide.");
  }
  return body.guide;
}

export async function askVibeGuide(
  question: string,
  guide: VibeGuide,
): Promise<VibeAskResult> {
  const response = await fetch("/api/vibe-coder/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ question, guide }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (VibeAskResult & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error || `Ask failed (${response.status}).`);
  }
  if (!body?.answer) {
    throw new Error("No answer came back.");
  }
  return body;
}

export async function fetchVibePreview(
  fullName: string,
): Promise<VibePreviewStatus> {
  const url = new URL("/api/vibe-coder/preview", window.location.origin);
  url.searchParams.set("fullName", fullName);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as
    | (VibePreviewStatus & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error || `Preview status failed (${response.status}).`);
  }
  return {
    enabled: Boolean(body?.enabled),
    run: body?.run ?? null,
  };
}

export async function startVibePreview(fullName: string): Promise<VibePreviewRun> {
  const response = await fetch("/api/vibe-coder/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ fullName, action: "start" }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    run?: VibePreviewRun;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Compile failed (${response.status}).`);
  }
  if (!body?.run) throw new Error("Compile started without a run state.");
  return body.run;
}

export async function stopVibePreview(
  fullName: string,
): Promise<VibePreviewRun | null> {
  const response = await fetch("/api/vibe-coder/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ fullName, action: "stop" }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    run?: VibePreviewRun | null;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Stop failed (${response.status}).`);
  }
  return body?.run ?? null;
}

export async function ensureVibePreview(
  fullName: string,
): Promise<VibePreviewStatus> {
  const current = await fetchVibePreview(fullName);
  if (!current.enabled) return current;
  if (current.run && ACTIVE_PREVIEW.has(current.run.status)) return current;
  if (current.run?.status === "error") return current;
  const run = await startVibePreview(fullName);
  return { enabled: true, run };
}

export type VibeInspectReport = import("@/lib/vibe-coder/inspectTypes").InspectReport;
export type VibeInspectTarget = import("@/lib/vibe-coder/inspectTypes").InspectTarget;

export async function fetchVibeInspect(
  fullName: string,
): Promise<VibeInspectReport> {
  const url = new URL("/api/vibe-coder/inspect", window.location.origin);
  url.searchParams.set("fullName", fullName);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as {
    report?: VibeInspectReport;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Inspect failed (${response.status}).`);
  }
  if (!body?.report) throw new Error("No frontend report came back.");
  return body.report;
}

export async function fetchVibeSourcePages(
  fullName: string,
): Promise<VibeSourcePage[]> {
  const url = new URL("/api/vibe-coder/pages", window.location.origin);
  url.searchParams.set("fullName", fullName);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as {
    pages?: VibeSourcePage[];
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Pages failed (${response.status}).`);
  }
  return body?.pages ?? [];
}

export function vibeSourcePageUrl(fullName: string, route: string): string {
  const url = new URL("/api/vibe-coder/pages/render", window.location.origin);
  url.searchParams.set("fullName", fullName);
  url.searchParams.set("route", route);
  url.searchParams.set("inspect", "1");
  return url.pathname + url.search;
}
