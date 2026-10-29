import { toUserFacingError } from "@/lib/errors/userFacing";
import { getPublicExplainVideo, isSavedVideoId } from "@/lib/experiment/savedVideos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    if (!isSavedVideoId(id)) {
      return Response.json({ error: "Explainer not found." }, { status: 404 });
    }
    const video = await getPublicExplainVideo(id);
    if (!video?.videoUrl) {
      return Response.json({ error: "Explainer not found." }, { status: 404 });
    }
    return Response.json({ video });
  } catch (error) {
    return Response.json(
      { error: toUserFacingError(error, "Could not load that explainer.") },
      { status: 500 },
    );
  }
}
