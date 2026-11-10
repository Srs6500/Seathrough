import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/env";

export type AuthUser = {
  id: string;
  username: string;
  email: string | null;
};

/** Resolve the signed-in user from an Authorization Bearer token. */
export async function getUserFromRequest(
  request: Request,
): Promise<AuthUser | null> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : null;
  if (!token) return null;

  try {
    const { url, anonKey } = getSupabaseConfig();
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;

    const { data: profile } = await client
      .from("profiles")
      .select("username")
      .eq("id", data.user.id)
      .maybeSingle();

    const username =
      profile?.username ||
      (data.user.user_metadata?.username as string | undefined) ||
      data.user.email?.split("@")[0] ||
      "learner";

    return {
      id: data.user.id,
      username,
      email: data.user.email ?? null,
    };
  } catch {
    return null;
  }
}
