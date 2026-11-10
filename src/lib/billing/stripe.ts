import "server-only";
import Stripe from "stripe";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

let client: Stripe | null = null;

/** Shared Stripe SDK — secret key only, never import from client components. */
export function getStripe(): Stripe {
  const key = optional("STRIPE_SECRET_KEY");
  if (!key) {
    throw new Error("Missing required environment variable: STRIPE_SECRET_KEY");
  }
  client ??= new Stripe(key);
  return client;
}

export function getStripePriceId(): string {
  const price =
    optional("STRIPE_PRICE_ID") ?? optional("STRIPE_PRICE_ID_PRO") ?? "";
  if (!price) {
    throw new Error(
      "Missing required environment variable: STRIPE_PRICE_ID (or STRIPE_PRICE_ID_PRO)",
    );
  }
  return price;
}

export function getStripeWebhookSecret(): string {
  const secret = optional("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    throw new Error("Missing required environment variable: STRIPE_WEBHOOK_SECRET");
  }
  return secret;
}

export function stripeConfigured(): boolean {
  return Boolean(
    optional("STRIPE_SECRET_KEY") &&
      (optional("STRIPE_PRICE_ID") || optional("STRIPE_PRICE_ID_PRO")),
  );
}

/** Public app origin for Checkout success/cancel + Portal return URLs. */
export function billingAppUrl(request: Request): string {
  const fromEnv =
    optional("NEXT_PUBLIC_APP_URL") ??
    optional("APP_URL") ??
    optional("NEXT_PUBLIC_SITE_URL");
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export function subscriptionIsPro(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}
