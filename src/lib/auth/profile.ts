import { emailToUsernameCandidate } from "@/lib/auth/email";
import { isValidUsername } from "@/lib/auth/username";
import { getServiceSupabase } from "@/lib/supabase/server";

/** Ensure a profiles row exists for a Supabase Auth user. Returns username. */
export async function ensureProfileForUser(input: {
  userId: string;
  email?: string | null;
  preferredUsername?: string | null;
}): Promise<string> {
  const service = getServiceSupabase();
  const { data: existing } = await service
    .from("profiles")
    .select("username")
    .eq("id", input.userId)
    .maybeSingle();

  if (existing?.username) return existing.username as string;

  const preferred = input.preferredUsername?.trim().toLowerCase() ?? "";
  const base = isValidUsername(preferred)
    ? preferred
    : emailToUsernameCandidate(input.email ?? "learner@seethrough.local");

  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = attempt === 0 ? "" : String(attempt + 1);
    const maxBase = 24 - suffix.length;
    const username = `${base.slice(0, Math.max(3, maxBase))}${suffix}`;

    const { error } = await service.from("profiles").insert({
      id: input.userId,
      username,
      display_name: username,
    });

    if (!error) return username;

    // Unique violation — try next suffix. Anything else: stop.
    if (!/duplicate|unique|23505/i.test(error.message)) {
      console.error("[auth/ensureProfile]", error.message);
      break;
    }
  }

  return base;
}
