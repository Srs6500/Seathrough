import { createSign } from "node:crypto";
import { getGithubAppConfig } from "@/lib/env";

export type GithubRepoOption = {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export function isGithubAppConfigured(): boolean {
  return getGithubAppConfig().configured;
}

/** URL that sends the learner into the GitHub App install flow. */
export function githubAppInstallUrl(state?: string): string {
  const cfg = getGithubAppConfig();
  if (!cfg.configured || !cfg.slug) {
    throw new Error(
      "GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY.",
    );
  }
  const url = new URL(`https://github.com/apps/${cfg.slug}/installations/new`);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function githubAppStatus() {
  const cfg = getGithubAppConfig();
  return {
    configured: cfg.configured,
    slug: cfg.slug || null,
    privateKeyError: cfg.privateKeyError ?? null,
  };
}

function requireApp() {
  const cfg = getGithubAppConfig();
  if (!cfg.configured) {
    throw new Error(
      "GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY.",
    );
  }
  return cfg;
}

function appJwt(): string {
  const cfg = requireApp();
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: cfg.appId,
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const signature = signer.sign(cfg.privateKey).toString("base64url");
  return `${data}.${signature}`;
}

async function githubFetch<T>(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Seethrough-data-flow",
    ...(init?.headers ?? {}),
  };
  if (init?.token) {
    (headers as Record<string, string>).Authorization = `Bearer ${init.token}`;
  }
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getInstallation(installationId: number): Promise<{
  id: number;
  account: { login: string; type: string };
}> {
  return githubFetch(`/app/installations/${installationId}`, {
    token: appJwt(),
  });
}

export async function createInstallationToken(
  installationId: number,
): Promise<string> {
  const body = await githubFetch<{ token: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST", token: appJwt() },
  );
  return body.token;
}

export async function listInstallationRepos(
  installationId: number,
): Promise<GithubRepoOption[]> {
  const token = await createInstallationToken(installationId);
  const repos: GithubRepoOption[] = [];
  let page = 1;
  while (page <= 10) {
    const batch = await githubFetch<{
      repositories: Array<{
        id: number;
        full_name: string;
        private: boolean;
        default_branch: string;
      }>;
    }>(`/installation/repositories?per_page=100&page=${page}`, { token });
    for (const repo of batch.repositories ?? []) {
      repos.push({
        id: repo.id,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
      });
    }
    if ((batch.repositories?.length ?? 0) < 100) break;
    page += 1;
  }
  return repos;
}

export type GithubTreeEntry = {
  path: string;
  type: "blob" | "tree" | string;
  sha: string;
  size?: number;
};

/** Resolve branch/tag/SHA to the commit's tree SHA for recursive listing. */
async function resolveTreeSha(input: {
  token?: string;
  owner: string;
  repo: string;
  ref: string;
}): Promise<string> {
  const { owner, repo, ref, token } = input;
  const encoded = encodeURIComponent(ref);
  // Works for branch names, tags, and full commit SHAs.
  const commit = await githubFetch<{
    commit?: { tree?: { sha?: string } };
    sha?: string;
  }>(`/repos/${owner}/${repo}/commits/${encoded}`, { token });
  const treeSha = commit.commit?.tree?.sha;
  if (!treeSha) {
    throw new Error(`Could not resolve tree for ref "${ref}".`);
  }
  return treeSha;
}

/** Recursive file tree for a repo ref (branch, tag, or commit SHA). */
export async function getRepoTree(input: {
  token?: string;
  owner: string;
  repo: string;
  ref: string;
}): Promise<{ truncated: boolean; tree: GithubTreeEntry[] }> {
  const { owner, repo, ref, token } = input;
  const treeSha = await resolveTreeSha({ token, owner, repo, ref });
  const body = await githubFetch<{
    truncated: boolean;
    tree: GithubTreeEntry[];
  }>(`/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, {
    token,
  });
  return {
    truncated: Boolean(body.truncated),
    tree: body.tree ?? [],
  };
}

/** Decode a blob by SHA (prefer over contents API for tree walks). */
export async function getRepoBlobText(input: {
  token?: string;
  owner: string;
  repo: string;
  sha: string;
}): Promise<string> {
  const { owner, repo, sha, token } = input;
  const body = await githubFetch<{
    encoding: string;
    content: string;
    size: number;
  }>(`/repos/${owner}/${repo}/git/blobs/${sha}`, { token });
  if (body.encoding === "base64") {
    return Buffer.from(body.content.replace(/\n/g, ""), "base64").toString(
      "utf8",
    );
  }
  return body.content ?? "";
}

export async function getRepoMeta(input: {
  token?: string;
  owner: string;
  repo: string;
}): Promise<{
  id: number;
  defaultBranch: string;
  fullName: string;
  private: boolean;
  language: string | null;
}> {
  const body = await githubFetch<{
    id: number;
    default_branch: string;
    full_name: string;
    private: boolean;
    language: string | null;
  }>(`/repos/${input.owner}/${input.repo}`, { token: input.token });
  return {
    id: body.id,
    defaultBranch: body.default_branch,
    fullName: body.full_name,
    private: Boolean(body.private),
    language: body.language ?? null,
  };
}

/** Read a text file from the repo via the Contents API (404 → null). */
export async function getRepoContentsText(input: {
  token?: string;
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}): Promise<string | null> {
  const { owner, repo, path, token } = input;
  const encodedPath = path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  const qs = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Seethrough-data-flow",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${qs}`,
    { headers },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for contents/${path}`);
  }
  const body = (await response.json()) as {
    encoding?: string;
    content?: string;
    type?: string;
  };
  if (body.type !== "file" || !body.content) return null;
  if (body.encoding === "base64") {
    return Buffer.from(body.content.replace(/\n/g, ""), "base64").toString(
      "utf8",
    );
  }
  return body.content;
}

/** Public raw.githubusercontent.com fetch (no API quota; public repos only). */
export async function getPublicRawText(input: {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}): Promise<string | null> {
  const encodedPath = input.path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  const url = `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${encodeURIComponent(input.ref)}/${encodedPath}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Seethrough-data-flow" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub raw ${response.status} for ${input.path}`);
  }
  return response.text();
}
