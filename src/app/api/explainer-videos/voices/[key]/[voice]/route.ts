import { readFile } from "node:fs/promises";
import { sampleFile } from "@/lib/explainer-video/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/explainer-videos/voices/[key]/[voice]">) {
  const { key, voice } = await ctx.params;
  const file = sampleFile(key, voice);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await readFile(file)), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600" },
  });
}
