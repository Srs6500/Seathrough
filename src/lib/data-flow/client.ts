import type { FlowMapResult } from "@/lib/data-flow/types";

export type GithubConnectionStatus = {
  configured: boolean;
  connected: boolean;
  slug: string | null;
  privateKeyError: string | null;
  message?: string;
};

export type GithubRepoOption = {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export async function fetchGithubStatus(
  accessToken?: string | null,
): Promise<GithubConnectionStatus> {
  const headers: HeadersInit = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch("/api/data-flow/github/status", {
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || `Status failed (${response.status}).`);
  }
  return (await response.json()) as GithubConnectionStatus;
}

/** Open the GitHub App install flow in this window. */
export function startGithubConnect(
  accessToken: string,
  returnTo: "/data-flow" | "/bug-analyzer" = "/data-flow",
): void {
  const url = new URL("/api/data-flow/github/connect", window.location.origin);
  url.searchParams.set("token", accessToken);
  url.searchParams.set("returnTo", returnTo);
  window.location.href = url.toString();
}

/** List/search repos available through the user's GitHub App installations. */
export async function searchGithubRepos(
  accessToken: string,
  query: string,
): Promise<GithubRepoOption[]> {
  const url = new URL("/api/data-flow/github/repos", window.location.origin);
  if (query.trim()) url.searchParams.set("q", query.trim());
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || `Repo search failed (${response.status}).`);
  }
  const body = (await response.json()) as { repos: GithubRepoOption[] };
  return body.repos ?? [];
}

export type { FlowMapResult };

export async function buildRepoFlowMap(
  accessToken: string,
  input: {
    repo: string;
    question: string;
    ref?: string;
    priorNodeIds?: string[];
  },
): Promise<FlowMapResult> {
  const response = await fetch("/api/data-flow/map", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (FlowMapResult & { error?: string; needConnect?: boolean })
    | null;
  if (!response.ok) {
    const err = new Error(body?.error || `Map failed (${response.status}).`) as Error & {
      needConnect?: boolean;
    };
    err.needConnect = Boolean(body?.needConnect);
    throw err;
  }
  return body as FlowMapResult;
}
