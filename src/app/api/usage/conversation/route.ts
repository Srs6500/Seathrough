import { NextResponse } from "next/server";
import { isMeteredFeature } from "@/lib/billing/config";
import { beginConversation, getRequester } from "@/lib/billing/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start (or continue) a conversation on a metered feature.
 * 200 { allowed: true, ... } or 429 { allowed: false, reason, resetAt, ... }.
 */
export async function POST(request: Request) {
  let body: { feature?: unknown; conversationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const feature = body.feature;
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId.trim().slice(0, 200) : "";
  if (!isMeteredFeature(feature) || !conversationId) {
    return NextResponse.json({ error: "feature and conversationId are required" }, { status: 400 });
  }

  const requester = await getRequester(request);
  try {
    const result = await beginConversation(requester, feature, conversationId);
    return NextResponse.json(result, { status: result.allowed ? 200 : 429 });
  } catch (error) {
    // Billing tables missing or Supabase down: don't lock people out of the app.
    console.error("[usage/conversation] failing open", error);
    return NextResponse.json({ allowed: true, plan: "free", remaining: null, degraded: true });
  }
}
