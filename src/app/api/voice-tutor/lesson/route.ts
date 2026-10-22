import {
  DEFAULT_VOICE_TUTOR_LESSON_ID,
  getVoiceTutorLesson,
  listVoiceTutorLessons,
} from "@/lib/voice-tutor/lessons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim() || DEFAULT_VOICE_TUTOR_LESSON_ID;

  if (searchParams.get("list") === "1") {
    return Response.json({ lessons: listVoiceTutorLessons() });
  }

  const lesson = getVoiceTutorLesson(id);
  if (!lesson) {
    return Response.json({ error: "Lesson not found." }, { status: 404 });
  }
  return Response.json({ lesson });
}
