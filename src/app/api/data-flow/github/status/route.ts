import { getUserFromRequest } from "@/lib/auth/requestUser";
import { githubAppStatus } from "@/lib/data-flow/githubApp";
import { userHasGithubConnection } from "@/lib/data-flow/installations";

export const runtime = "nodejs";

/** App configured + whether this user already connected an installation. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  const app = githubAppStatus();
  let connected = false;
  if (user && app.configured) {
    try {
      connected = await userHasGithubConnection(user.id);
    } catch {
      connected = false;
    }
  }
  return Response.json({
    configured: app.configured,
    connected,
    slug: app.slug,
    privateKeyError: app.privateKeyError,
    message: user ? undefined : "Sign in to connect GitHub.",
  });
}
