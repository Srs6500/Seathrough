/**
 * Public origin used in Supabase Auth emails (confirm signup, reset password).
 * Local → localhost; production → seethroughus.com (unless env overrides).
 */

const PROD_ORIGIN = "https://seethroughus.com";
const LOCAL_ORIGIN = "http://localhost:3000";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function envOrigin(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "";
  return raw ? stripTrailingSlash(raw) : null;
}

function isProdRuntime(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

/** Site origin for auth emails and post-confirm redirects. */
export function authSiteUrl(request?: Request): string {
  const fromEnv = envOrigin();
  if (fromEnv) return fromEnv;

  if (isProdRuntime()) return PROD_ORIGIN;

  if (request) {
    try {
      const origin = new URL(request.url).origin;
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        return origin;
      }
    } catch {
      // fall through
    }
  }

  return LOCAL_ORIGIN;
}

/** Supabase `emailRedirectTo` — confirmation link lands here. */
export function authEmailRedirectTo(request?: Request): string {
  return `${authSiteUrl(request)}/auth/callback`;
}
