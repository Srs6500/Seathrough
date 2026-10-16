import {
  createInstallationToken,
  getInstallation,
  listInstallationRepos,
  type GithubRepoOption,
} from "@/lib/data-flow/githubApp";
import { getServiceSupabase } from "@/lib/supabase/server";

export type StoredInstallation = {
  installationId: number;
  accountLogin: string | null;
  accountType: string | null;
};

export async function upsertInstallation(input: {
  userId: string;
  installationId: number;
}): Promise<StoredInstallation> {
  const installation = await getInstallation(input.installationId);
  const db = getServiceSupabase();
  const { error } = await db.from("github_installations").upsert(
    {
      user_id: input.userId,
      installation_id: input.installationId,
      account_login: installation.account.login,
      account_type: installation.account.type,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,installation_id" },
  );
  if (error) throw new Error(error.message);
  return {
    installationId: input.installationId,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
  };
}

export async function listInstallationsForUser(
  userId: string,
): Promise<StoredInstallation[]> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("github_installations")
    .select("installation_id, account_login, account_type")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    installationId: Number(row.installation_id),
    accountLogin: (row.account_login as string | null) ?? null,
    accountType: (row.account_type as string | null) ?? null,
  }));
}

export async function userHasGithubConnection(userId: string): Promise<boolean> {
  const rows = await listInstallationsForUser(userId);
  return rows.length > 0;
}

export async function listReposForUser(
  userId: string,
): Promise<GithubRepoOption[]> {
  const installs = await listInstallationsForUser(userId);
  const byId = new Map<number, GithubRepoOption>();
  for (const install of installs) {
    const repos = await listInstallationRepos(install.installationId);
    for (const repo of repos) byId.set(repo.id, repo);
  }
  return [...byId.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

export async function searchReposForUser(
  userId: string,
  query: string,
  limit = 30,
): Promise<GithubRepoOption[]> {
  const repos = await listReposForUser(userId);
  const q = query.trim().toLowerCase();
  if (!q) return repos.slice(0, limit);
  return repos
    .filter((repo) => {
      const full = repo.fullName.toLowerCase();
      const name = full.split("/")[1] ?? full;
      return full.includes(q) || name.includes(q);
    })
    .slice(0, limit);
}

const ALLOWED_RETURN_TO = new Set(["/data-flow", "/bug-analyzer"]);

export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/data-flow";
  const path = raw.startsWith("/") ? raw.split("?")[0]! : "";
  return ALLOWED_RETURN_TO.has(path) ? path : "/data-flow";
}

export function parseConnectState(
  raw: string | null,
): { userId: string; returnTo: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as { userId?: string; returnTo?: string };
    if (!parsed.userId || typeof parsed.userId !== "string") return null;
    return {
      userId: parsed.userId,
      returnTo: sanitizeReturnTo(parsed.returnTo),
    };
  } catch {
    return null;
  }
}

/** Find an installation that can access `fullName` and return a token. */
export async function resolveRepoAccess(
  userId: string,
  fullName: string,
): Promise<{
  token: string;
  repo: GithubRepoOption;
  installationId: number;
} | null> {
  const target = fullName.trim().toLowerCase();
  const installs = await listInstallationsForUser(userId);
  for (const install of installs) {
    const repos = await listInstallationRepos(install.installationId);
    const repo = repos.find((r) => r.fullName.toLowerCase() === target);
    if (!repo) continue;
    const token = await createInstallationToken(install.installationId);
    return {
      token,
      repo,
      installationId: install.installationId,
    };
  }
  return null;
}
