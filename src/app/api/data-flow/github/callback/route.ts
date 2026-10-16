import { resolveAppOrigin } from "@/lib/data-flow/appOrigin";
import {
  parseConnectState,
  sanitizeReturnTo,
  upsertInstallation,
} from "@/lib/data-flow/installations";

export const runtime = "nodejs";

/** GitHub App setup callback — stores the installation for the signed-in user. */
export async function GET(request: Request) {
  const origin = resolveAppOrigin(request);
  const url = new URL(request.url);
  const installationIdRaw = url.searchParams.get("installation_id");
  const state = parseConnectState(url.searchParams.get("state"));
  const returnTo = sanitizeReturnTo(state?.returnTo);

  if (!installationIdRaw) {
    return Response.redirect(`${origin}${returnTo}?github=cancelled`, 302);
  }

  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    return Response.redirect(`${origin}${returnTo}?github=cancelled`, 302);
  }

  if (!state?.userId) {
    return Response.redirect(`${origin}${returnTo}?github=signin`, 302);
  }

  try {
    await upsertInstallation({
      userId: state.userId,
      installationId,
    });
  } catch {
    return Response.redirect(`${origin}${returnTo}?github=error`, 302);
  }

  return Response.redirect(`${origin}${returnTo}?github=connected`, 302);
}
