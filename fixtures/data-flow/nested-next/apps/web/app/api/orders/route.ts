import { insertOrder } from "@/lib/db";

export async function POST() {
  await insertOrder();
  return Response.json({ ok: true });
}
