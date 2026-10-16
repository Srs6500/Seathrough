/** Public origin used for GitHub App install redirects. */

export function resolveAppOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (proto && host) return `${proto}://${host}`;

  const url = new URL(request.url);
  return url.origin;
}
