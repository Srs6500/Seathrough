import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import {
  getBillingAccount,
  upsertBillingAccount,
} from "@/lib/billing/server";
import {
  billingAppUrl,
  getStripe,
  getStripePriceId,
  stripeConfigured,
} from "@/lib/billing/stripe";
import { PRO_MONTHLY_PRICE_USD } from "@/lib/billing/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start Stripe Checkout for the $9/mo Pro subscription. Auth required. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to upgrade to Pro." },
      { status: 401 },
    );
  }
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured yet." },
      { status: 503 },
    );
  }

  try {
    const stripe = getStripe();
    const priceId = getStripePriceId();
    const existing = await getBillingAccount(user.id);

    if (existing?.plan === "pro" && existing.plan_source === "stripe") {
      return NextResponse.json(
        { error: "You're already on Pro. Manage billing from your account menu." },
        { status: 400 },
      );
    }

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: user.username,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await upsertBillingAccount(user.id, {
        stripe_customer_id: customerId,
        plan: existing?.plan ?? "free",
        plan_source: existing?.plan_source ?? null,
        promo_code: existing?.promo_code ?? null,
        stripe_subscription_id: existing?.stripe_subscription_id ?? null,
        subscription_status: existing?.subscription_status ?? null,
      });
    }

    const appUrl = billingAppUrl(request);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/billing/cancel`,
      allow_promotion_codes: true,
      metadata: { user_id: user.id },
      subscription_data: {
        metadata: { user_id: user.id },
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a Checkout URL." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      url: session.url,
      priceUsd: PRO_MONTHLY_PRICE_USD,
    });
  } catch (error) {
    console.error("[billing/checkout]", error);
    return NextResponse.json(
      { error: "Could not start Checkout. Try again." },
      { status: 500 },
    );
  }
}
