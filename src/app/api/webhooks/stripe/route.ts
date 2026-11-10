import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  applyStripeSubscription,
  getBillingAccountByCustomerId,
} from "@/lib/billing/server";
import { getStripe, getStripeWebhookSecret } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe → SeeThrough plan sync.
 * Configure the endpoint in Stripe Dashboard / CLI to this path and subscribe to:
 * checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted, invoice.paid, invoice.payment_failed.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (error) {
    console.error(
      "[webhooks/stripe] signature",
      error instanceof Error ? error.message : "invalid",
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const userId =
          session.client_reference_id ||
          session.metadata?.user_id ||
          null;
        const customerId = customerIdOf(session.customer);
        const subscriptionId = idOf(session.subscription);
        if (!userId || !customerId) break;

        let status = "active";
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          status = sub.status;
        }
        await applyStripeSubscription({
          userId,
          customerId,
          subscriptionId,
          status,
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId(sub);
        if (!userId) break;
        await applyStripeSubscription({
          userId,
          customerId: customerIdOf(sub.customer),
          subscriptionId: sub.id,
          status: sub.status,
        });
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = subscriptionIdFromInvoice(invoice);
        if (!subscriptionId) break;
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const userId = await resolveUserId(sub);
        if (!userId) break;
        await applyStripeSubscription({
          userId,
          customerId: customerIdOf(sub.customer),
          subscriptionId: sub.id,
          status: sub.status,
        });
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("[webhooks/stripe] handler", error);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function customerIdOf(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if ("deleted" in value && value.deleted) return null;
  return value.id;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (parent?.type === "subscription_details") {
    return idOf(parent.subscription_details?.subscription ?? null);
  }
  // Older shape / expanded field fallbacks.
  const legacy = (invoice as { subscription?: string | { id: string } | null })
    .subscription;
  return idOf(legacy ?? null);
}

async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.user_id?.trim();
  if (fromMeta) return fromMeta;
  const customerId = customerIdOf(sub.customer);
  if (!customerId) return null;
  const account = await getBillingAccountByCustomerId(customerId);
  return account?.user_id ?? null;
}
