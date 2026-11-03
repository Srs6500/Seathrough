import { startRender } from "@/lib/explainer-video/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Previewed and approved → render the MP4 and mix it. */
export async function POST(_request: Request, ctx: RouteContext<"/api/explainer-videos/jobs/[id]/render">) {
  const { id } = await ctx.params;
  const job = await startRender(id);
  if (!job) return Response.json({ error: "No such video." }, { status: 404 });
  return Response.json({ job });
}
