/** Email helpers for Supabase Auth signup / login. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length < 5 || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

/**
 * Derive a profiles.username candidate from an email local-part.
 * Must satisfy `^[a-z0-9_]{3,24}$`.
 */
export function emailToUsernameCandidate(email: string): string {
  const local = normalizeEmail(email).split("@")[0] ?? "learner";
  let base = local
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (base.length < 3) base = `${base}user`.slice(0, 24);
  return base.slice(0, 24);
}
