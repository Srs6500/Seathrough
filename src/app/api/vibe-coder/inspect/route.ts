import { withSeethroughDebug } from "@seethrough/debug/next";
import { getRepoMeta, isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { buildInspectReport } from "@/lib/vibe-coder/inspectRepo";
import {
  readVibeGithubSession,
  resolveVibeRepoAccess,
} from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = withSeethroughDebug(async (request) => {
  const fullName = new URL(request.url).searchParams.get("fullName") ?? "";
  if (!fullName.includes("/")) {
    return Response.json({ error: "fullName is required (owner/repo)." }, { status: 400 });
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
    const report = await buildInspectReport({ fullName, token, ref });
    return Response.json({ report });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read that frontend.";
    return Response.json({ error: message }, { status: 400 });
  }
});
