import { toUserFacingError } from "@/lib/errors/userFacing";
import { TOPIC_MAX } from "@/lib/explain-video/film";
import { filmWriterMissing, generatePlan } from "@/lib/explain-video/generate";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  topic: z.string().trim().min(1).max(TOPIC_MAX),
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
    return Response.json(
      { error: `Enter a topic or paste text (up to ${TOPIC_MAX.toLocaleString()} characters).` },
      { status: 400 },
    );
  }

  try {
    const plan = await generatePlan(parsed.data.topic);
    return Response.json(plan);
  } catch (error) {
    console.error("[explain-video] plan failed", error instanceof Error ? error.message : "error");
    return Response.json(
      { error: toUserFacingError(error, "The film could not be written. Try again in a moment.") },
      { status: 500 },
    );
  }
}
