import { getUserFromRequest } from "@/lib/auth/requestUser";
import { buildFlowFromQuestion } from "@/lib/data-flow/flowFromQuestion";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { resolveRepoAccess } from "@/lib/data-flow/installations";
import { indexRepo } from "@/lib/data-flow/indexRepo";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";
import { fetchRepoSourceFiles } from "@/lib/data-flow/repoFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  repo?: string;
  fullName?: string;
  question?: string;
  ref?: string;
  priorNodeIds?: string[];
};

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isGithubAppConfigured()) {
    return Response.json(
      { error: "GitHub App is not configured." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return Response.json(
      { error: "Add a question about the flow you want to see." },
      { status: 400 },
    );
  }

  const parsed =
    parseGithubRepoInput(body.repo ?? "") ||
    parseGithubRepoInput(body.fullName ?? "");
  if (!parsed) {
    return Response.json(
      {
        error:
          "Enter a GitHub repo link or owner/repo.",
      },
      { status: 400 },
    );
  }

  const access = await resolveRepoAccess(user.id, parsed.fullName);
  if (!access) {
    return Response.json(
      {
        error:
          "Repository not available. Connect GitHub and grant access to this repo.",
        needConnect: true,
      },
      { status: 404 },
    );
  }

  try {
    const fetched = await fetchRepoSourceFiles({
      token: access.token,
      fullName: access.repo.fullName,
      ref: body.ref?.trim() || parsed.ref || access.repo.defaultBranch,
    });
    const index = indexRepo(fetched.files);
    const map = buildFlowFromQuestion({
      index,
      question,
      fullName: fetched.fullName,
      ref: fetched.ref,
      fileCount: fetched.files.length,
      truncated: fetched.truncatedTree,
      priorNodeIds: Array.isArray(body.priorNodeIds)
        ? body.priorNodeIds.filter((id) => typeof id === "string").slice(0, 40)
        : undefined,
    });
    return Response.json(map);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build flow map.";
    return Response.json({ error: message }, { status: 502 });
  }
}
