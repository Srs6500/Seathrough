import { toUserFacingError } from "@/lib/errors/userFacing";
import { parseVoiceTutorStyle } from "@/lib/voice-tutor/lessonStyle";
import { VoiceLessonPlanSchema } from "@/lib/voice-tutor/sessionTypes";
import { generateWhiteboard } from "@/lib/voice-tutor/whiteboard/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lesson plan in → whiteboard session JSON (items with exact coordinates) out. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { plan?: unknown; style?: unknown };
    const parsed = VoiceLessonPlanSchema.safeParse(body.plan);
    if (!parsed.success) {
      return Response.json({ error: "A lesson plan is required." }, { status: 400 });
    }
    const whiteboard = await generateWhiteboard(
      parsed.data,
      parseVoiceTutorStyle(body.style),
    );
    return Response.json({ whiteboard });
  } catch (error) {
    return Response.json(
      { error: toUserFacingError(error, "Couldn't set up the whiteboard.") },
      { status: 500 },
    );
  }
}
