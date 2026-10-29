import { createHash, createHmac } from "node:crypto";
import {
  createInstallationToken,
  listInstallationRepos,
  type GithubRepoOption,
} from "@/lib/data-flow/githubApp";

export const VIBE_GITHUB_COOKIE = "vibe_github";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

export type VibeGithubSession = {
  installationIds: number[];
  login: string | null;
};

function signingKey(): Buffer {
  const material =
    process.env.GITHUB_APP_PRIVATE_KEY?.trim() ||
    process.env.VIBE_GITHUB_SECRET?.trim() ||
    "vibe-coder-github";
  return createHash("sha256").update(`vibe-github:${material}`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function encodeSession(ids: number[], login?: string | null): string {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))].slice(
    0,
    10,
  );
  const payload = Buffer.from(
    JSON.stringify({
      ids: unique,
      login: (login || "").trim() || null,
      exp: Date.now() + MAX_AGE_SEC * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeVibeGithubCookie(raw: string | undefined | null): VibeGithubSession | null {
  if (!raw || !raw.includes(".")) return null;
  const dot = raw.lastIndexOf(".");
  const payload = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!payload || !mac || sign(payload) !== mac) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      ids?: unknown;
      login?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.exp === "number" && parsed.exp < Date.now()) return null;
    const ids = (Array.isArray(parsed.ids) ? parsed.ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) return null;
    return {
      installationIds: ids,
      login: typeof parsed.login === "string" && parsed.login.trim() ? parsed.login.trim() : null,
    };
  } catch {
    return null;
  }
}

export function readVibeGithubSession(request: Request): VibeGithubSession | null {
  const header = request.headers.get("cookie") || "";
  const match = header.match(
    new RegExp(`(?:^|;\\s*)${VIBE_GITHUB_COOKIE}=([^;]+)`),
  );
  if (!match?.[1]) return null;
  return decodeVibeGithubCookie(decodeURIComponent(match[1]));
}

export function vibeGithubCookieOptions(clear = false): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: clear ? 0 : MAX_AGE_SEC,
  };
}

export function nextVibeGithubCookie(
  existing: VibeGithubSession | null,
  installationId: number,
): string {
  return vibeGithubCookieFromIds([
    ...(existing?.installationIds ?? []),
    installationId,
  ]);
}

export function vibeGithubCookieFromIds(ids: number[], login?: string | null): string {
  return encodeSession(ids, login);
}

export function emptyVibeGithubCookie(): string {
  return "";
}

export async function listReposForVibeSession(
  session: VibeGithubSession,
  query = "",
  limit = 30,
): Promise<GithubRepoOption[]> {
  const batches = await Promise.all(
    session.installationIds.map((id) => listInstallationRepos(id)),
  );
  const byId = new Map<number, GithubRepoOption>();
  for (const repos of batches) {
    for (const repo of repos) byId.set(repo.id, repo);
  }
  const all = [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, limit);
  return all
    .filter((repo) => {
      const full = repo.fullName.toLowerCase();
      const name = full.split("/")[1] ?? full;
      return full.includes(q) || name.includes(q);
    })
    .slice(0, limit);
}

export function parseVibeConnectState(raw: string | null): { returnTo: "/vibe-coder" } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      vibe?: unknown;
    };
    if (parsed.vibe !== true) return null;
    return { returnTo: "/vibe-coder" };
  } catch {
    return null;
  }
}

export async function resolveVibeRepoAccess(
  session: VibeGithubSession,
  fullName: string,
): Promise<{
  token: string;
  repo: GithubRepoOption;
  installationId: number;
} | null> {
  const target = fullName.trim().toLowerCase();
  for (const installationId of session.installationIds) {
    const repos = await listInstallationRepos(installationId);
    const repo = repos.find((item) => item.fullName.toLowerCase() === target);
    if (!repo) continue;
    return {
      token: await createInstallationToken(installationId),
      repo,
      installationId,
    };
  }
  return null;
}
