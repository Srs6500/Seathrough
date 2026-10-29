import { withSeethroughDebug } from "@seethrough/debug/next";
import { getRepoMeta, isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";
import { listSourcePages } from "@/lib/vibe-coder/sourcePages";
import {
  readVibeGithubSession,
  resolveVibeRepoAccess,
} from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function accessFor(request: Request, fullName: string) {
  const session = readVibeGithubSession(request);
  let token: string | undefined;
  let ref: string | undefined;
  if (session && isGithubAppConfigured()) {
    const access = await resolveVibeRepoAccess(session, fullName);
    if (access) {
      token = access.token;
      ref = access.repo.defaultBranch;
    }
  }
  if (!ref) {
    try {
      const meta = await getRepoMeta({
        token,
        owner: fullName.split("/")[0] ?? "",
        repo: fullName.split("/")[1] ?? "",
      });
      ref = meta.defaultBranch;
    } catch {
      ref = "HEAD";
    }
  }
  return { token, ref };
}

export const GET = withSeethroughDebug(async (request) => {
  const fullName = new URL(request.url).searchParams.get("fullName") ?? "";
  if (!fullName.includes("/")) {
    return Response.json({ error: "fullName is required (owner/repo)." }, { status: 400 });
  }
  try {
    const access = await accessFor(request, fullName);
    const { pages } = await listSourcePages({
      fullName,
      token: access.token,
      ref: access.ref,
    });
    return Response.json({ pages });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read those pages.";
    return Response.json({ error: message }, { status: 400 });
  }
});
