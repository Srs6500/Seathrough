import { withSeethroughDebug } from "@seethrough/debug/next";
import { buildDataIndex } from "@/lib/bug-analyzer/buildDataIndex";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { resolveRepoAccess } from "@/lib/data-flow/installations";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";
import { fetchRepoSourceFiles } from "@/lib/data-flow/repoFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  fullName?: string;
  repo?: string;
  ref?: string;
  scope?: "file" | "repo";
  path?: string;
};

export const POST = withSeethroughDebug(async (request) => {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
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
      {
        error:
          "Enter a GitHub repo link or owner/repo (e.g. vercel/next.js).",
      },
      { status: 400 },
    );
  }

  const scope = body.scope === "file" ? "file" : "repo";
  const focusPath = body.path?.trim() || null;
  if (scope === "file" && !focusPath) {
    return Response.json(
      { error: "path is required when scope is file." },
      { status: 400 },
    );
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
    const fetched = await fetchRepoSourceFiles({
      token,
      fullName: parsed.fullName,
      ref,
    });
    const index = await buildDataIndex({
      fullName: fetched.fullName,
      ref: fetched.ref,
      scope,
      focusPath,
      files: fetched.files,
      truncated: fetched.truncatedTree,
    });
    return Response.json({ index });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to build data index.";
    const needConnect =
      /private|grant access|not found|404/i.test(message) && !token;
    return Response.json(
      { error: message, needConnect },
      { status: needConnect ? 404 : 502 },
    );
  }
});
