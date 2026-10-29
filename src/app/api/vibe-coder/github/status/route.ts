import { githubAppStatus } from "@/lib/data-flow/githubApp";
import { readVibeGithubSession } from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const app = githubAppStatus();
  const session = readVibeGithubSession(request);
  return Response.json({
    configured: app.configured,
    connected: Boolean(session),
    login: session?.login ?? null,
    slug: app.slug,
    privateKeyError: app.privateKeyError,
  });
}
