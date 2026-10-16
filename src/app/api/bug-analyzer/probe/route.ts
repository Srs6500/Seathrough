import { withSeethroughDebug } from "@seethrough/debug/next";
import {
  detectRepoStack,
  type RepoWithStack,
} from "@/lib/bug-analyzer/detectStack";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { getRepoMeta, isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { resolveRepoAccess } from "@/lib/data-flow/installations";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Resolve a public (or installed) repo URL into a selector row. */
export const POST = withSeethroughDebug(async (request) => {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { repo?: string };
  try {
    body = (await request.json()) as { repo?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseGithubRepoInput(body.repo ?? "");
  if (!parsed) {
    return Response.json(
      {
        error:
          "Enter a GitHub repo link or owner/repo (e.g. vercel/commerce).",
      },
      { status: 400 },
    );
  }

  let token: string | undefined;
  if (isGithubAppConfigured()) {
    const access = await resolveRepoAccess(user.id, parsed.fullName);
    if (access) token = access.token;
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
            "This repository is private. Connect GitHub and grant access.",
          needConnect: true,
        },
        { status: 404 },
      );
    }

    const stack = await detectRepoStack({
      token,
      fullName: meta.fullName,
      defaultBranch: meta.defaultBranch,
    });
    const name = meta.fullName.split("/")[1] ?? meta.fullName;
    const repo: RepoWithStack = {
      id: meta.id,
      fullName: meta.fullName,
      private: meta.private,
      defaultBranch: meta.defaultBranch,
      name,
      stackLabel: stack.stackLabel,
      badge: stack.badge,
    };
    return Response.json({ repo });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load repository.";
    return Response.json({ error: message }, { status: 502 });
  }
});
