// Server only (uses the Supabase service role key).
import { cookies } from "next/headers";
import { getUserFromRequest, type AuthUser } from "@/lib/auth/requestUser";
import { getServiceSupabase } from "@/lib/supabase/server";
import {
  FREE_CONVERSATIONS_PER_FEATURE,
  METERED_FEATURES,
  type BillingStatus,
  type ConversationAllowed,
  type ConversationLimitHit,
  type MeteredFeature,
  type Plan,
  type PlanSource,
} from "@/lib/billing/config";
import { stripeConfigured, subscriptionIsPro } from "@/lib/billing/stripe";

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

export type BillingRow = {
  user_id: string;
  plan: Plan;
  plan_source: PlanSource | null;
  promo_code: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
};

const BILLING_SELECT =
  "user_id, plan, plan_source, promo_code, stripe_customer_id, stripe_subscription_id, subscription_status";

export async function getBillingAccount(userId: string): Promise<BillingRow | null> {
  const { data, error } = await getServiceSupabase()
    .from("billing_accounts")
    .select(BILLING_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as BillingRow | null) ?? null;
}

export async function getBillingAccountByCustomerId(
  customerId: string,
): Promise<BillingRow | null> {
  const { data, error } = await getServiceSupabase()
    .from("billing_accounts")
    .select(BILLING_SELECT)
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  return (data as BillingRow | null) ?? null;
}

export async function upsertBillingAccount(
  userId: string,
  patch: Partial<Omit<BillingRow, "user_id">>,
): Promise<void> {
  const { error } = await getServiceSupabase()
    .from("billing_accounts")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
  if (error) throw error;
}

/**
 * Apply a Stripe subscription status onto the billing account.
 * Promo Pro is preserved unless Stripe explicitly grants Pro (or the
 * account was already on Stripe).
 */
export async function applyStripeSubscription(input: {
  userId: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  status: string;
}): Promise<void> {
  const existing = await getBillingAccount(input.userId);
  const pro = subscriptionIsPro(input.status);
  const wasStripe = existing?.plan_source === "stripe";
  const keepPromo = existing?.plan_source === "promo" && !pro && !wasStripe;

  await upsertBillingAccount(input.userId, {
    stripe_customer_id:
      input.customerId ?? existing?.stripe_customer_id ?? null,
    stripe_subscription_id:
      input.subscriptionId ?? existing?.stripe_subscription_id ?? null,
    subscription_status: input.status,
    plan: keepPromo ? "pro" : pro ? "pro" : "free",
    plan_source: keepPromo ? "promo" : pro || wasStripe ? "stripe" : null,
    promo_code: existing?.promo_code ?? null,
  });
}

// ---------------------------------------------------------------------------
// Conversation limits (lifetime free allotment)
// ---------------------------------------------------------------------------

type UsageRow = { conversation_key: string; created_at: string };

async function lifetimeUsage(
  requester: Requester,
  feature: MeteredFeature | null,
): Promise<Array<UsageRow & { feature: MeteredFeature }>> {
  // Signed-out usage on this browser still counts after signing up, so
  // creating an account isn't a free reset.
  const subject = requester.user
    ? `user_id.eq.${requester.user.id},anon_id.eq.${requester.anonId}`
    : `anon_id.eq.${requester.anonId}`;
  let query = getServiceSupabase()
    .from("usage_conversations")
    .select("feature, conversation_key, created_at")
    .or(subject)
    .order("created_at", { ascending: true })
    .limit(500);
  if (feature) query = query.eq("feature", feature);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Array<UsageRow & { feature: MeteredFeature }>;
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
 * The same conversationKey again is free (follow-ups). Free accounts get a
 * lifetime allotment of FREE_CONVERSATIONS_PER_FEATURE per feature.
 */
export async function beginConversation(
  requester: Requester,
  feature: MeteredFeature,
  conversationKey: string,
): Promise<ConversationAllowed | ConversationLimitHit> {
  if (await isPro(requester.user)) {
    return { allowed: true, plan: "pro", remaining: null };
  }

  const rows = dedupeByKey(await lifetimeUsage(requester, feature));
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
      resetAt: null,
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
  const rows = await lifetimeUsage(requester, null);
  const usage = {} as BillingStatus["usage"];
  for (const feature of Object.keys(METERED_FEATURES) as MeteredFeature[]) {
    const mine = dedupeByKey(rows.filter((row) => row.feature === feature));
    usage[feature] = {
      used: mine.length,
      limit: FREE_CONVERSATIONS_PER_FEATURE,
      resetAt: null,
    };
  }
  const planSource: PlanSource | null =
    plan === "pro" && (account?.plan_source === "promo" || account?.plan_source === "stripe")
      ? account.plan_source
      : null;
  return {
    signedIn: Boolean(requester.user),
    plan,
    planSource,
    stripeEnabled: stripeConfigured(),
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
