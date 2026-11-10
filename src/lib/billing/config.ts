/** Shared (client + server) billing constants. */

/** Free conversations per metered feature for an account (lifetime — no rolling reset). */
export const FREE_CONVERSATIONS_PER_FEATURE = 5;

/** Pro subscription list price shown in the paywall (USD / month). */
export const PRO_MONTHLY_PRICE_USD = 9;

export const METERED_FEATURES = {
  "smart-tutor": "Smart tutor",
  "system-design": "System design",
  "vibe-coder": "Vibe coder",
  browser: "Browser",
} as const;

export type MeteredFeature = keyof typeof METERED_FEATURES;

export function isMeteredFeature(value: unknown): value is MeteredFeature {
  return typeof value === "string" && value in METERED_FEATURES;
}

export type Plan = "free" | "pro";

export type PlanSource = "promo" | "stripe";

/** Body of a 429 from /api/usage/conversation. */
export type ConversationLimitHit = {
  allowed: false;
  /** signup = signed out; upgrade = signed-in free user. */
  reason: "signup" | "upgrade";
  feature: MeteredFeature;
  limit: number;
  /** Always null for the lifetime free allotment (kept for older clients). */
  resetAt: string | null;
};

export type ConversationAllowed = {
  allowed: true;
  plan: Plan;
  /** Free conversations left on this feature; null for Pro. */
  remaining: number | null;
};

export type BillingStatus = {
  signedIn: boolean;
  plan: Plan;
  planSource: PlanSource | null;
  /** True when Checkout / Portal can be opened (Stripe env present). */
  stripeEnabled: boolean;
  usage: Record<
    MeteredFeature,
    { used: number; limit: number; resetAt: string | null }
  >;
};
