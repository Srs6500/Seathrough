import { withSeethroughDebug } from "@seethrough/debug/next";
import { listReposWithStackForUser } from "@/lib/bug-analyzer/detectStack";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** List repos with stack detection for the Bug Analyzer selector. */
export const GET = withSeethroughDebug(async (request) => {
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

  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const repos = await listReposWithStackForUser(user.id, query);
    return Response.json({ repos });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not list repositories.";
    return Response.json({ error: message }, { status: 500 });
  }
});
