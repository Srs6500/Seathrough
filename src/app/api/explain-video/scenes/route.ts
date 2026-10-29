import { toUserFacingError } from "@/lib/errors/userFacing";
import { planSchema, TOPIC_MAX } from "@/lib/explain-video/film";
import {
  filmWriterMissing,
  generateSceneCode,
  repairSceneCode,
} from "@/lib/explain-video/generate";
import { SCENE_CODE_MAX } from "@/lib/explain-video/sceneCode";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const requestSchema = z.object({
  topic: z.string().trim().min(1).max(TOPIC_MAX),
  plan: planSchema,
  indexes: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  repairs: z
    .array(
      z.object({
        index: z.number().int().min(0).max(6),
        code: z.string().max(SCENE_CODE_MAX * 2).nullable(),
        error: z.string().min(1).max(600),
      }),
    )
    .min(1)
    .max(7)
    .optional(),
});

export async function POST(request: Request) {
  if (filmWriterMissing()) {
    return Response.json({ error: "The film writer is not configured yet." }, { status: 500 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "The film plan is not valid. Plan the film again." }, { status: 400 });
  }
  const { topic, plan, repairs, indexes } = parsed.data;
  if (repairs?.some((repair) => repair.index >= plan.scenes.length)) {
    return Response.json({ error: "The film plan is not valid. Plan the film again." }, { status: 400 });
  }
  if (indexes?.some((index) => index >= plan.scenes.length)) {
    return Response.json({ error: "The film plan is not valid. Plan the film again." }, { status: 400 });
  }

  try {
    if (repairs) {
      const fixed = await repairSceneCode(topic, plan, repairs);
      return Response.json({ repairs: fixed });
    }
    return Response.json(await generateSceneCode(topic, plan, indexes));
  } catch (error) {
    console.error("[explain-video] drawing failed", error instanceof Error ? error.message : "error");
    return Response.json(
      { error: toUserFacingError(error, "The film could not be drawn. Try again in a moment.") },
      { status: 500 },
    );
  }
}
