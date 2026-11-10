import { toUserFacingError } from "@/lib/errors/userFacing";
import { pickLessonImages } from "@/lib/voice-tutor/images/pick";
import { parseVoiceTutorStyle } from "@/lib/voice-tutor/lessonStyle";
import { VoiceLessonPlanSchema } from "@/lib/voice-tutor/sessionTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Lesson plan in → pictures from credible sources for the beats that need one. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { plan?: unknown; style?: unknown };
    const parsed = VoiceLessonPlanSchema.safeParse(body.plan);
    if (!parsed.success) {
      return Response.json({ error: "A lesson plan is required." }, { status: 400 });
    }
    const figures = await pickLessonImages(
      parsed.data,
      parseVoiceTutorStyle(body.style),
    );
    return Response.json({ figures });
  } catch (error) {
    return Response.json(
      { error: toUserFacingError(error, "Couldn't find pictures for this lesson.") },
      { status: 500 },
    );
  }
}
