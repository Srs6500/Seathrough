import { NextResponse } from "next/server";
import {
  exchangeGithubOAuthCode,
  findInstallationsForOAuthUser,
} from "@/lib/data-flow/githubApp";
import {
  VIBE_GITHUB_COOKIE,
  nextVibeGithubCookie,
  readVibeGithubSession,
  vibeGithubCookieFromIds,
  vibeGithubCookieOptions,
} from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    url.host;
  return `${proto}://${host}`;
}

function home(origin: string, flag: "connected" | "cancelled" | "error", reason?: string) {
  const url = new URL("/vibe-coder", origin);
  url.searchParams.set("github", flag);
  if (reason) url.searchParams.set("reason", reason.slice(0, 180));
  return url.toString();
}

function safeReason(error: unknown): string {
  const text =
    error instanceof Error ? error.message : "GitHub authorization failed.";
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer")
    .replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted]")
    .slice(0, 180);
}

function redirectWithInstalls(
  origin: string,
  ids: number[],
  login: string | null,
) {
  const response = NextResponse.redirect(home(origin, "connected"));
  response.cookies.set(
    VIBE_GITHUB_COOKIE,
    vibeGithubCookieFromIds(ids, login),
    vibeGithubCookieOptions(),
  );
  return response;
}

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const url = new URL(request.url);
  const redirectUri = `${origin}/api/vibe-coder/github/callback`;
  const code = url.searchParams.get("code");
  const installationIdRaw = url.searchParams.get("installation_id");

  if (code) {
    try {
      const token = await exchangeGithubOAuthCode(code, redirectUri);
      const found = await findInstallationsForOAuthUser(token);
      if (found.ids.length === 0) {
        return NextResponse.redirect(
          home(
            origin,
            "error",
            found.login
              ? `Signed in as ${found.login}, but SeeThroughApplearn is not installed on that account.`
              : "GitHub signed you in, but SeeThroughApplearn is not installed on that account.",
          ),
        );
      }
      return redirectWithInstalls(origin, found.ids, found.login || null);
    } catch (error) {
      return NextResponse.redirect(home(origin, "error", safeReason(error)));
    }
  }

  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    return NextResponse.redirect(home(origin, "cancelled"));
  }

  const response = NextResponse.redirect(home(origin, "connected"));
  response.cookies.set(
    VIBE_GITHUB_COOKIE,
    nextVibeGithubCookie(readVibeGithubSession(request), installationId),
    vibeGithubCookieOptions(),
  );
  return response;
}
