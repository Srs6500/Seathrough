import { getUserFromRequest } from "@/lib/auth/requestUser";
import { scanComponentCards } from "@/lib/data-flow/componentScan";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { resolveRepoAccess } from "@/lib/data-flow/installations";
import { fetchRepoSourceFiles } from "@/lib/data-flow/repoFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  fullName?: string;
  ref?: string;
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

  const fullName = (body.fullName ?? "").trim();
  if (!fullName || !fullName.includes("/")) {
    return Response.json(
      { error: "fullName is required (owner/repo)." },
      { status: 400 },
    );
  }

  const access = await resolveRepoAccess(user.id, fullName);
  if (!access) {
    return Response.json(
      {
        error:
          "Repository not found on your GitHub App installations. Reconnect or grant access.",
      },
      { status: 404 },
    );
  }

  try {
    const fetched = await fetchRepoSourceFiles({
      token: access.token,
      fullName: access.repo.fullName,
      ref: body.ref?.trim() || access.repo.defaultBranch,
    });
    const cards = scanComponentCards(fetched.files);

    return Response.json({
      fullName: fetched.fullName,
      ref: fetched.ref,
      fileCount: fetched.files.length,
      truncated: fetched.truncatedTree,
      cards,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to scan repository.";
    return Response.json({ error: message }, { status: 502 });
  }
}
