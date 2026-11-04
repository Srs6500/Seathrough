import { NextResponse } from "next/server";
import { getBillingStatus, getRequester } from "@/lib/billing/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requester = await getRequester(request);
  try {
    return NextResponse.json(await getBillingStatus(requester));
  } catch (error) {
    console.error("[billing/status]", error);
    return NextResponse.json({ error: "Could not load your plan." }, { status: 500 });
  }
}
