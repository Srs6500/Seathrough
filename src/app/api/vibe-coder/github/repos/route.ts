import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import {
  listReposForVibeSession,
  readVibeGithubSession,
} from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isGithubAppConfigured()) {
    return Response.json({ error: "GitHub App is not configured." }, { status: 503 });
  }
  const session = readVibeGithubSession(request);
  if (!session) {
    return Response.json({ repos: [], connected: false });
  }
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const repos = await listReposForVibeSession(session, query);
    return Response.json({ repos, connected: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not list repositories.";
    return Response.json({ error: message }, { status: 500 });
  }
}
