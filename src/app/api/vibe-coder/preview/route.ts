import { withSeethroughDebug } from "@seethrough/debug/next";
import {
  getLocalRun,
  isLocalRunEnabled,
  startLocalRun,
  stopLocalRun,
} from "@/lib/bug-analyzer/localRun";
import { getRepoMeta, isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";
import {
  readVibeGithubSession,
  resolveVibeRepoAccess,
} from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  fullName?: string;
  repo?: string;
  ref?: string;
  action?: "start" | "stop";
};

function missingRepo() {
  return Response.json(
    { error: "fullName is required (owner/repo)." },
    { status: 400 },
  );
}

export async function GET(request: Request) {
  const fullName = new URL(request.url).searchParams.get("fullName") ?? "";
  if (!fullName.includes("/")) return missingRepo();
  return Response.json({
    enabled: isLocalRunEnabled(),
    run: getLocalRun(fullName),
  });
}

export const POST = withSeethroughDebug(async (request) => {
  const session = readVibeGithubSession(request);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed =
    parseGithubRepoInput(body.repo ?? "") ||
    parseGithubRepoInput(body.fullName ?? "");
  if (!parsed) {
    return Response.json(
      { error: "Enter a GitHub repo as owner/repo." },
      { status: 400 },
    );
  }

  if (body.action === "stop") {
    const run = await stopLocalRun(parsed.fullName);
    return Response.json({ enabled: isLocalRunEnabled(), run });
  }

  if (!isLocalRunEnabled()) {
    return Response.json(
      {
        error:
          "Local compile is only available in development (or SEETHROUGH_LOCAL_RUN=1).",
        enabled: false,
      },
      { status: 403 },
    );
  }

  let token: string | undefined;
  let ref = body.ref?.trim() || parsed.ref;

  if (session && isGithubAppConfigured()) {
    const access = await resolveVibeRepoAccess(session, parsed.fullName);
    if (access) {
      token = access.token;
      ref = ref || access.repo.defaultBranch;
    }
  }

  try {
    const meta = await getRepoMeta({
      token,
      owner: parsed.owner,
      repo: parsed.repo,
    });
    if (meta.private && !token) {
      return Response.json(
        {
          error:
            "Private repo — connect GitHub and grant access before compiling.",
        },
        { status: 404 },
      );
    }
    ref = ref || meta.defaultBranch;
    const run = await startLocalRun({
      fullName: meta.fullName,
      token,
      ref,
      injectInspector: false,
    });
    return Response.json({ enabled: true, run });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not compile that repository.";
    return Response.json({ error: message }, { status: 502 });
  }
});
