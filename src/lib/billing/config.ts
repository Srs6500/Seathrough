/** Shared (client + server) billing constants. */

export const FREE_CONVERSATIONS_PER_FEATURE = 5;
export const USAGE_WINDOW_HOURS = 12;
export const USAGE_WINDOW_MS = USAGE_WINDOW_HOURS * 60 * 60 * 1000;

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

/** Body of a 429 from /api/usage/conversation. */
export type ConversationLimitHit = {
  allowed: false;
  /** signup = signed out; upgrade = signed-in free user (can enter a promo code). */
  reason: "signup" | "upgrade";
  feature: MeteredFeature;
  limit: number;
  /** ISO time the next free conversation opens up on this feature. */
  resetAt: string;
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
  planSource: "promo" | null;
  usage: Record<
    MeteredFeature,
    { used: number; limit: number; resetAt: string | null }
  >;
};
