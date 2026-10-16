import { getUserFromRequest } from "@/lib/auth/requestUser";
import { resolveAppOrigin } from "@/lib/data-flow/appOrigin";
import {
  githubAppInstallUrl,
  isGithubAppConfigured,
} from "@/lib/data-flow/githubApp";
import { sanitizeReturnTo } from "@/lib/data-flow/installations";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/env";

export const runtime = "nodejs";

async function userFromTokenParam(token: string | null) {
  if (!token) return null;
  try {
    const { url, anonKey } = getSupabaseConfig();
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id };
  } catch {
    return null;
  }
}

/** Start the GitHub App install flow. Accepts Bearer auth or ?token= for redirects. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));
  const user =
    (await getUserFromRequest(request)) ||
    (await userFromTokenParam(tokenParam));

  if (!user) {
    return Response.redirect(
      `${resolveAppOrigin(request)}${returnTo}?github=signin`,
      302,
    );
  }

  if (!isGithubAppConfigured()) {
    return Response.json(
      {
        error:
          "GitHub App is not configured on this server. Ask the operator to set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY.",
      },
      { status: 503 },
    );
  }

  const state = Buffer.from(
    JSON.stringify({
      userId: user.id,
      returnTo,
      nonce: crypto.randomUUID(),
    }),
  ).toString("base64url");

  return Response.redirect(githubAppInstallUrl(state), 302);
}
