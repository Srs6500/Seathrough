import { getUserFromRequest } from "@/lib/auth/requestUser";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { searchReposForUser } from "@/lib/data-flow/installations";

export const runtime = "nodejs";

/** Search repos available through the user's GitHub App installations. */
export async function GET(request: Request) {
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
    const repos = await searchReposForUser(user.id, query);
    return Response.json({ repos });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not list repositories.";
    return Response.json({ error: message }, { status: 500 });
  }
}
