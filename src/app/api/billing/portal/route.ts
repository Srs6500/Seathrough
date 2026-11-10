import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { getBillingAccount } from "@/lib/billing/server";
import {
  billingAppUrl,
  getStripe,
  stripeConfigured,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open the Stripe Customer Portal (manage / cancel subscription). Auth required. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in to manage billing." }, { status: 401 });
  }
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured yet." },
      { status: 503 },
    );
  }

  try {
    const account = await getBillingAccount(user.id);
    if (!account?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No Stripe billing account yet. Upgrade to Pro first." },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: billingAppUrl(request),
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[billing/portal]", error);
    return NextResponse.json(
      { error: "Could not open the billing portal. Try again." },
      { status: 500 },
    );
  }
}
