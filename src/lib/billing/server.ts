// Server only (uses the Supabase service role key).
import { cookies } from "next/headers";
import { getUserFromRequest, type AuthUser } from "@/lib/auth/requestUser";
import { getServiceSupabase } from "@/lib/supabase/server";
import {
  FREE_CONVERSATIONS_PER_FEATURE,
  METERED_FEATURES,
  USAGE_WINDOW_MS,
  type BillingStatus,
  type ConversationAllowed,
  type ConversationLimitHit,
  type MeteredFeature,
  type Plan,
} from "@/lib/billing/config";

// ---------------------------------------------------------------------------
// Who is asking: signed-in user (Bearer token) and/or an anonymous cookie id.
// ---------------------------------------------------------------------------

const ANON_COOKIE = "st_anon";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Requester = { user: AuthUser | null; anonId: string };

/** Resolve the caller, minting the anonymous cookie if it's missing. Route handlers only. */
export async function getRequester(request: Request): Promise<Requester> {
  const user = await getUserFromRequest(request);
  const store = await cookies();
  let anonId = store.get(ANON_COOKIE)?.value ?? "";
  if (!UUID_RE.test(anonId)) {
    anonId = crypto.randomUUID();
    store.set(ANON_COOKIE, anonId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return { user, anonId };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

type BillingRow = {
  user_id: string;
  plan: Plan;
  plan_source: "promo" | null;
};

export async function getBillingAccount(userId: string): Promise<BillingRow | null> {
  const { data, error } = await getServiceSupabase()
    .from("billing_accounts")
    .select("user_id, plan, plan_source")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as BillingRow | null) ?? null;
}

export async function upsertBillingAccount(
  userId: string,
  patch: Partial<Omit<BillingRow, "user_id">> & { promo_code?: string | null },
): Promise<void> {
  const { error } = await getServiceSupabase()
    .from("billing_accounts")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Conversation limits
// ---------------------------------------------------------------------------

type UsageRow = { conversation_key: string; created_at: string };

async function recentUsage(
  requester: Requester,
  feature: MeteredFeature | null,
): Promise<Array<UsageRow & { feature: MeteredFeature }>> {
  const since = new Date(Date.now() - USAGE_WINDOW_MS).toISOString();
  // Signed-out usage on this browser still counts after signing up, so
  // creating an account isn't a free reset.
  const subject = requester.user
    ? `user_id.eq.${requester.user.id},anon_id.eq.${requester.anonId}`
    : `anon_id.eq.${requester.anonId}`;
  let query = getServiceSupabase()
    .from("usage_conversations")
    .select("feature, conversation_key, created_at")
    .gte("created_at", since)
    .or(subject)
    .order("created_at", { ascending: true })
    .limit(500);
  if (feature) query = query.eq("feature", feature);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Array<UsageRow & { feature: MeteredFeature }>;
}

/** When the next slot frees up, given rows in the window (oldest first). */
function nextResetAt(rows: UsageRow[]): string | null {
  const distinct = dedupeByKey(rows);
  if (distinct.length < FREE_CONVERSATIONS_PER_FEATURE) return null;
  const freeing = distinct[distinct.length - FREE_CONVERSATIONS_PER_FEATURE];
  return new Date(new Date(freeing.created_at).getTime() + USAGE_WINDOW_MS).toISOString();
}

function dedupeByKey<T extends UsageRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.conversation_key)) return false;
    seen.add(row.conversation_key);
    return true;
  });
}

async function isPro(user: AuthUser | null): Promise<boolean> {
  if (!user) return false;
  const account = await getBillingAccount(user.id);
  return account?.plan === "pro";
}

/**
 * Record the start of a conversation on a feature, or refuse it.
 * The same conversationKey again within the window is free (follow-ups).
 */
export async function beginConversation(
  requester: Requester,
  feature: MeteredFeature,
  conversationKey: string,
): Promise<ConversationAllowed | ConversationLimitHit> {
  if (await isPro(requester.user)) {
    return { allowed: true, plan: "pro", remaining: null };
  }

  const rows = dedupeByKey(await recentUsage(requester, feature));
  if (rows.some((row) => row.conversation_key === conversationKey)) {
    return {
      allowed: true,
      plan: "free",
      remaining: Math.max(0, FREE_CONVERSATIONS_PER_FEATURE - rows.length),
    };
  }

  if (rows.length >= FREE_CONVERSATIONS_PER_FEATURE) {
    return {
      allowed: false,
      reason: requester.user ? "upgrade" : "signup",
      feature,
      limit: FREE_CONVERSATIONS_PER_FEATURE,
      resetAt:
        nextResetAt(rows) ?? new Date(Date.now() + USAGE_WINDOW_MS).toISOString(),
    };
  }

  const { error } = await getServiceSupabase()
    .from("usage_conversations")
    .insert({
      feature,
      conversation_key: conversationKey,
      user_id: requester.user?.id ?? null,
      anon_id: requester.anonId,
    });
  if (error) throw error;

  return {
    allowed: true,
    plan: "free",
    remaining: FREE_CONVERSATIONS_PER_FEATURE - rows.length - 1,
  };
}

export async function getBillingStatus(requester: Requester): Promise<BillingStatus> {
  const account = requester.user ? await getBillingAccount(requester.user.id) : null;
  const plan: Plan = account?.plan === "pro" ? "pro" : "free";
  const rows = await recentUsage(requester, null);
  const usage = {} as BillingStatus["usage"];
  for (const feature of Object.keys(METERED_FEATURES) as MeteredFeature[]) {
    const mine = dedupeByKey(rows.filter((row) => row.feature === feature));
    usage[feature] = {
      used: mine.length,
      limit: FREE_CONVERSATIONS_PER_FEATURE,
      resetAt: nextResetAt(mine),
    };
  }
  return {
    signedIn: Boolean(requester.user),
    plan,
    planSource: plan === "pro" ? (account?.plan_source ?? null) : null,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

/** Codes from PRO_PROMO_CODES (comma separated). Matching ignores case. */
export function matchPromoCode(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  if (!wanted) return null;
  const codes = (process.env.PRO_PROMO_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  return codes.find((code) => code.toLowerCase() === wanted) ?? null;
}
