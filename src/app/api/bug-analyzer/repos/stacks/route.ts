import { withSeethroughDebug } from "@seethrough/debug/next";
import { enrichRepoStacksForUser } from "@/lib/bug-analyzer/detectStack";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Cheap stack labels for visible picker rows (root package.json only). */
export const POST = withSeethroughDebug(async (request) => {
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

  let body: { fullNames?: unknown };
  try {
    body = (await request.json()) as { fullNames?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fullNames = Array.isArray(body.fullNames)
    ? body.fullNames.filter((name): name is string => typeof name === "string")
    : [];

  try {
    const repos = await enrichRepoStacksForUser(user.id, fullNames);
    return Response.json({ repos });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not label repositories.";
    return Response.json({ error: message }, { status: 500 });
  }
});
