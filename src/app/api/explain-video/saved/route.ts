import { getUserFromRequest } from "@/lib/auth/requestUser";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { clip, planSchema, TOPIC_MAX } from "@/lib/explain-video/film";
import {
  EXPLAIN_VIDEO_KIND,
  insertSavedLessonVideo,
  listSavedLessonVideos,
} from "@/lib/experiment/savedVideos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_POSTER_BYTES = 2 * 1024 * 1024;
const VIDEO_TYPES = /^video\/(mp4|webm)$/;

export async function GET(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json({ videos: [], error: "Sign in required" }, { status: 401 });
    }
    const videos = await listSavedLessonVideos(user.id, EXPLAIN_VIDEO_KIND);
    return Response.json({ videos });
  } catch (error) {
    return Response.json(
      { videos: [], error: toUserFacingError(error, "Could not load saved videos.") },
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

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "A video file is required." }, { status: 400 });
    }
    const file = form.get("video");
    const poster = form.get("poster");
    if (!(file instanceof File) || file.size < 1024) {
      return Response.json({ error: "A video file is required." }, { status: 400 });
    }
    const mimeType = (file.type || "").split(";")[0]!;
    if (!VIDEO_TYPES.test(mimeType)) {
      return Response.json({ error: "Only MP4 or WebM videos can be saved." }, { status: 415 });
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return Response.json({ error: "That video is too large to save." }, { status: 413 });
    }

    const topic = clip(form.get("topic"), TOPIC_MAX);
    let plan: unknown = null;
    try {
      const parsed = planSchema.safeParse(JSON.parse(String(form.get("plan") ?? "null")));
      if (parsed.success) plan = parsed.data;
    } catch {
      plan = null;
    }
    const title =
      clip(form.get("title"), 60) ||
      (plan && typeof plan === "object" && "title" in plan ? clip(plan.title, 60) : "") ||
      clip(topic, 60) ||
      "Video explanation";
    const durationMs = Number(form.get("durationMs") ?? 0);

    const posterFile =
      poster instanceof File && poster.size > 0 && poster.size <= MAX_POSTER_BYTES && /^image\//.test(poster.type)
        ? poster
        : null;

    const video = await insertSavedLessonVideo({
      userId: user.id,
      title,
      titleSource: "ai",
      question: topic || undefined,
      lesson: { kind: EXPLAIN_VIDEO_KIND, topic, plan },
      video: Buffer.from(await file.arrayBuffer()),
      videoMime: mimeType,
      poster: posterFile ? Buffer.from(await posterFile.arrayBuffer()) : undefined,
      posterMime: posterFile?.type,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : undefined,
    });
    return Response.json({ video });
  } catch (error) {
    return Response.json(
      { error: toUserFacingError(error, "Could not save that video. Try again in a moment.") },
      { status: 500 },
    );
  }
}
