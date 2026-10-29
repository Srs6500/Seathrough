import { NextResponse } from "next/server";
import { resolveAppOrigin } from "@/lib/data-flow/appOrigin";
import {
  exchangeGithubOAuthCode,
  githubAppInstallUrl,
  listInstallationsForUserToken,
} from "@/lib/data-flow/githubApp";
import {
  parseConnectState,
  sanitizeReturnTo,
  upsertInstallation,
} from "@/lib/data-flow/installations";
import {
  VIBE_GITHUB_COOKIE,
  parseVibeConnectState,
  readVibeGithubSession,
  vibeGithubCookieFromIds,
  vibeGithubCookieOptions,
} from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";

function vibeHome(origin: string, flag: "connected" | "cancelled" | "error") {
  return `${origin}/vibe-coder?github=${flag}`;
}

function withVibeCookie(request: Request, origin: string, ids: number[]) {
  const existing = readVibeGithubSession(request);
  const response = NextResponse.redirect(vibeHome(origin, "connected"));
  response.cookies.set(
    VIBE_GITHUB_COOKIE,
    vibeGithubCookieFromIds([...(existing?.installationIds ?? []), ...ids]),
    vibeGithubCookieOptions(),
  );
  return response;
}

/** GitHub App setup + OAuth callback. */
export async function GET(request: Request) {
  const origin = resolveAppOrigin(request);
  const url = new URL(request.url);
  const rawState = url.searchParams.get("state");
  const vibeState = parseVibeConnectState(rawState);
  const userState = parseConnectState(rawState);
  const returnTo = sanitizeReturnTo(
    vibeState?.returnTo || userState?.returnTo,
  );
  const code = url.searchParams.get("code");
  const installationIdRaw = url.searchParams.get("installation_id");

  if (vibeState && code) {
    try {
      const token = await exchangeGithubOAuthCode(
        code,
        `${origin}/api/data-flow/github/callback`,
      );
      const ids = await listInstallationsForUserToken(token);
      if (ids.length === 0) {
        return Response.redirect(githubAppInstallUrl(rawState || undefined), 302);
      }
      return withVibeCookie(request, origin, ids);
    } catch {
      return Response.redirect(vibeHome(origin, "error"), 302);
    }
  }

  if (!installationIdRaw) {
    const dest = vibeState ? vibeHome(origin, "cancelled") : `${origin}${returnTo}?github=cancelled`;
    return Response.redirect(dest, 302);
  }

  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    const dest = vibeState ? vibeHome(origin, "cancelled") : `${origin}${returnTo}?github=cancelled`;
    return Response.redirect(dest, 302);
  }

  if (vibeState) {
    return withVibeCookie(request, origin, [installationId]);
  }

  if (!userState?.userId) {
    return Response.redirect(`${origin}${returnTo}?github=signin`, 302);
  }

  try {
    await upsertInstallation({
      userId: userState.userId,
      installationId,
    });
  } catch {
    return Response.redirect(`${origin}${returnTo}?github=error`, 302);
  }

  return Response.redirect(`${origin}${returnTo}?github=connected`, 302);
}
