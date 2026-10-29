import { getRepoMeta, isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import {
  readVibeGithubSession,
  resolveVibeRepoAccess,
} from "@/lib/vibe-coder/githubSession";
import { renderInspectPage } from "@/lib/vibe-coder/inspectRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fullName = url.searchParams.get("fullName") ?? "";
  const route = url.searchParams.get("route") ?? "";
  if (!fullName.includes("/") || !route.startsWith("/")) {
    return new Response("fullName and route are required.", { status: 400 });
  }

  let token: string | undefined;
  let ref: string | undefined;
  const session = readVibeGithubSession(request);
  if (session && isGithubAppConfigured()) {
    const access = await resolveVibeRepoAccess(session, fullName);
    if (access) {
      token = access.token;
      ref = access.repo.defaultBranch;
    }
  }
  if (!ref) {
    try {
      const [owner, repo] = fullName.split("/");
      const meta = await getRepoMeta({ token, owner: owner ?? "", repo: repo ?? "" });
      ref = meta.defaultBranch;
    } catch {
      ref = "HEAD";
    }
  }

  try {
    const { html } = await renderInspectPage({
      fullName,
      route,
      token,
      ref,
    });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not render that page.";
    return new Response(
      `<!doctype html><html><body style="font:14px sans-serif;padding:32px;color:#52525b">${message}</body></html>`,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
}
