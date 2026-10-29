import { githubAppOAuthUrl } from "@/lib/data-flow/githubApp";

export const runtime = "nodejs";

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    url.host;
  return `${proto}://${host}`;
}

/** GitHub OAuth for Vibe coder. Callback must match the GitHub App redirect URI. */
export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const redirectUri = `${origin}/api/vibe-coder/github/callback`;
  const state = Buffer.from(
    JSON.stringify({
      vibe: true,
      returnTo: "/vibe-coder",
      nonce: crypto.randomUUID(),
    }),
  ).toString("base64url");

  const oauth = githubAppOAuthUrl(redirectUri, state);
  if (!oauth) {
    return Response.redirect(
      `${origin}/vibe-coder?github=error&reason=${encodeURIComponent("GitHub OAuth client id is missing on the server.")}`,
      302,
    );
  }
  return Response.redirect(oauth, 302);
}
