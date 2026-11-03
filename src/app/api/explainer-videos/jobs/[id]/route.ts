import { readJob } from "@/lib/explainer-video/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/explainer-videos/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await readJob(id);
  if (!job) return Response.json({ error: "No such video." }, { status: 404 });
  return Response.json({ job });
}
