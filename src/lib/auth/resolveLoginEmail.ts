import { isValidEmail, normalizeEmail } from "@/lib/auth/email";
import {
  isValidUsername,
  normalizeUsername,
  usernameToEmail,
} from "@/lib/auth/username";
import { getServiceSupabase } from "@/lib/supabase/server";

export type ResolveLoginEmailResult =
  | { ok: true; email: string; username?: string }
  | { ok: false; error: string };

/**
 * Resolve a login identifier (email or username) to the Auth email to sign in with.
 * Username looks up `profiles`, then the Auth user email (or legacy synthetic email).
 */
export async function resolveLoginEmail(
  identifier: string,
): Promise<ResolveLoginEmailResult> {
  const raw = identifier.trim();
  if (!raw) {
    return { ok: false, error: "Enter your email or username" };
  }

  if (raw.includes("@")) {
    const email = normalizeEmail(raw);
    if (!isValidEmail(email)) {
      return { ok: false, error: "Enter a valid email or username" };
    }
    return { ok: true, email };
  }

  const username = normalizeUsername(raw);
  if (!isValidUsername(username)) {
    return {
      ok: false,
      error: "Username must be 3–24 characters: letters, numbers, or underscore",
    };
  }

  const service = getServiceSupabase();
  const { data: profile } = await service
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .maybeSingle();

  if (profile?.id) {
    const { data: userData, error } = await service.auth.admin.getUserById(
      profile.id as string,
    );
    const authEmail = userData.user?.email?.trim();
    if (!error && authEmail) {
      return {
        ok: true,
        email: normalizeEmail(authEmail),
        username: profile.username as string,
      };
    }
  }

  // Legacy accounts that used synthetic *@users.seathrough.local emails.
  return {
    ok: true,
    email: usernameToEmail(username),
    username,
  };
}
