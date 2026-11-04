import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { matchPromoCode, upsertBillingAccount } from "@/lib/billing/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Redeem a promo code (PRO_PROMO_CODES) for Pro without paying. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in to use a promo code." }, { status: 401 });
  }

  let body: { code?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = matchPromoCode(typeof body.code === "string" ? body.code.slice(0, 100) : "");
  if (!code) {
    // Small delay so codes can't be guessed quickly.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: "That promo code isn't valid." }, { status: 400 });
  }

  try {
    await upsertBillingAccount(user.id, {
      plan: "pro",
      plan_source: "promo",
      promo_code: code,
    });
    return NextResponse.json({ plan: "pro" });
  } catch (error) {
    console.error("[billing/redeem]", error);
    return NextResponse.json({ error: "Could not apply that code. Try again." }, { status: 500 });
  }
}
