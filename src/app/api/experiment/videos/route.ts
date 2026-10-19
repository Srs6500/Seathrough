import { getUserFromRequest } from "@/lib/auth/requestUser";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { generateLessonTitle } from "@/lib/experiment/generateLessonTitle";
import { clipTitle } from "@/lib/experiment/lessonTitle";
import {
  insertSavedLessonVideo,
  listSavedLessonVideos,
} from "@/lib/experiment/savedVideos";
import { coerceLesson } from "@/lib/experiment/scene";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_VIDEO_BYTES = 28 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json({ videos: [], error: "Sign in required" }, {
        status: 401,
      });
    }
    const videos = await listSavedLessonVideos(user.id);
    return Response.json({ videos });
  } catch (error) {
    return Response.json(
      {
        videos: [],
        error: toUserFacingError(error, "Could not load saved videos."),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("video");
    const poster = form.get("poster");
    const lessonRaw = form.get("lesson");
    const question = String(form.get("question") ?? "").slice(0, 200);
    const givenTitle = String(form.get("title") ?? "").trim();
    const durationMs = Number(form.get("durationMs") ?? 0);

    if (!(file instanceof File) || file.size < 64) {
      return Response.json({ error: "A video file is required." }, { status: 400 });
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return Response.json({ error: "That video is too large to save." }, {
        status: 413,
      });
    }

    let lesson;
    try {
      lesson = coerceLesson(
        JSON.parse(typeof lessonRaw === "string" ? lessonRaw : "{}"),
      );
    } catch {
      return Response.json({ error: "The lesson could not be saved." }, {
        status: 400,
      });
    }
    if (question && !lesson.question) lesson.question = question;

    const named = givenTitle ? clipTitle(givenTitle) : "";
    const generated = named
      ? { title: named, source: "user" as const }
      : await generateLessonTitle(lesson);

    const videoBuf = Buffer.from(await file.arrayBuffer());
    const posterBuf =
      poster instanceof File && poster.size > 0
        ? Buffer.from(await poster.arrayBuffer())
        : undefined;

    const video = await insertSavedLessonVideo({
      userId: user.id,
      title: generated.title,
      titleSource: generated.source,
      question: lesson.question,
      lesson,
      video: videoBuf,
      videoMime: file.type || "video/webm",
      poster: posterBuf,
      posterMime: poster instanceof File ? poster.type : "image/jpeg",
      durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
    });

    return Response.json({ video });
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "Could not save that video. Try again in a moment.",
        ),
      },
      { status: 500 },
    );
  }
}
