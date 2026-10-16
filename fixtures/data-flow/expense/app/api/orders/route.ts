import { db } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json();
  const order = await db.orders.insert({ total: body.total });
  return Response.json({ id: order.id });
}
