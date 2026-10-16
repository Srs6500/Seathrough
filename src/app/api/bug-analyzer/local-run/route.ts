import { getUserFromRequest } from "@/lib/auth/requestUser";
import {
  getLocalRun,
  isLocalRunEnabled,
  startLocalRun,
  stopLocalRun,
} from "@/lib/bug-analyzer/localRun";
import { getRepoMeta, isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { resolveRepoAccess } from "@/lib/data-flow/installations";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  fullName?: string;
  repo?: string;
  ref?: string;
  action?: "start" | "stop";
};

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const fullName = new URL(request.url).searchParams.get("fullName") ?? "";
  if (!fullName.includes("/")) {
    return Response.json(
      { error: "fullName is required (owner/repo)." },
      { status: 400 },
    );
  }
  return Response.json({
    enabled: isLocalRunEnabled(),
    run: getLocalRun(fullName),
  });
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isLocalRunEnabled()) {
    return Response.json(
      {
        error:
          "Local run is only available in development (or SEETHROUGH_LOCAL_RUN=1).",
      },
      { status: 403 },
    );
  }

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
    return Response.json({ run });
  }

  let token: string | undefined;
  let ref = body.ref?.trim() || parsed.ref;

  if (isGithubAppConfigured()) {
    const access = await resolveRepoAccess(user.id, parsed.fullName);
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
            "Private repo — connect GitHub and grant access before running locally.",
        },
        { status: 404 },
      );
    }
    ref = ref || meta.defaultBranch;
    const run = await startLocalRun({
      fullName: meta.fullName,
      token,
      ref,
    });
    return Response.json({ run });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start local run.";
    return Response.json({ error: message }, { status: 502 });
  }
}
