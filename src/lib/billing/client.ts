import type {
  BillingStatus,
  ConversationAllowed,
  ConversationLimitHit,
  MeteredFeature,
} from "@/lib/billing/config";

function authHeaders(accessToken: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

/** Ask the server whether this conversation may start. Network errors fail open. */
export async function requestConversation(
  feature: MeteredFeature,
  conversationId: string,
  accessToken: string | null,
): Promise<ConversationAllowed | ConversationLimitHit> {
  try {
    const res = await fetch("/api/usage/conversation", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ feature, conversationId }),
    });
    if (res.status === 429) return (await res.json()) as ConversationLimitHit;
    if (!res.ok) return { allowed: true, plan: "free", remaining: null };
    return (await res.json()) as ConversationAllowed;
  } catch {
    return { allowed: true, plan: "free", remaining: null };
  }
}

export async function fetchBillingStatus(accessToken: string | null): Promise<BillingStatus | null> {
  try {
    const res = await fetch("/api/billing/status", { headers: authHeaders(accessToken) });
    if (!res.ok) return null;
    return (await res.json()) as BillingStatus;
  } catch {
    return null;
  }
}

export async function redeemPromoCode(accessToken: string, code: string): Promise<void> {
  const res = await fetch("/api/billing/redeem", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(await readError(res, "That promo code isn't valid."));
}

/** Start Stripe Checkout; returns the hosted Checkout URL. */
export async function startCheckout(accessToken: string): Promise<string> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not start Checkout."));
  const body = (await res.json()) as { url?: string };
  if (!body.url) throw new Error("Could not start Checkout.");
  return body.url;
}

/** Open Stripe Customer Portal for managing / canceling Pro. */
export async function startBillingPortal(accessToken: string): Promise<string> {
  const res = await fetch("/api/billing/portal", {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not open billing portal."));
  const body = (await res.json()) as { url?: string };
  if (!body.url) throw new Error("Could not open billing portal.");
  return body.url;
}

export function newConversationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** "7h 42m" / "12m" / "less than a minute". */
export function formatTimeUntil(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 60_000) return "less than a minute";
  const mins = Math.ceil(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
