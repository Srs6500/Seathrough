import { getServiceSupabase } from "@/lib/supabase/server";
import type { ExperimentLesson } from "@/lib/experiment/scene";
import { EXPLAIN_VIDEO_KIND, type SavedVideoKind } from "@/lib/experiment/savedVideoKind";

export type SavedVideoTitleSource = "ai" | "user" | "lesson";

export { EXPLAIN_VIDEO_KIND, type SavedVideoKind };

export type SavedLessonVideo = {
  id: string;
  kind: SavedVideoKind;
  title: string;
  titleSource: SavedVideoTitleSource;
  question?: string;
  createdAt: string;
  durationMs?: number;
  mimeType: string;
  videoUrl?: string;
  posterUrl?: string;
};

const BUCKET = "lesson-videos";

function isMissingRelation(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /saved_lesson_videos/i.test(message) ||
    /schema cache/i.test(message)
  );
}

function asTitleSource(value: unknown): SavedVideoTitleSource {
  if (value === "user" || value === "ai" || value === "lesson") return value;
  return "lesson";
}

function asKind(value: unknown): SavedVideoKind {
  return value === EXPLAIN_VIDEO_KIND ? EXPLAIN_VIDEO_KIND : "lesson";
}

const COLUMNS =
  "id, title, title_source, question, created_at, duration_ms, mime_type, storage_path, poster_path, kind:lesson->>kind";

function rowToVideo(row: Record<string, unknown>): SavedLessonVideo {
  return {
    id: String(row.id),
    kind: asKind(row.kind),
    title: String(row.title || "Saved lesson"),
    titleSource: asTitleSource(row.title_source),
    question: typeof row.question === "string" ? row.question : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
    durationMs:
      typeof row.duration_ms === "number" ? row.duration_ms : undefined,
    mimeType: String(row.mime_type || "video/webm"),
  };
}

async function signedUrl(path: string | null | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const supabase = getServiceSupabase();
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24);
    return data?.signedUrl;
  } catch {
    return undefined;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSavedVideoId(id: string): boolean {
  return UUID_RE.test(id);
}

export async function insertSavedLessonVideo(input: {
  userId?: string | null;
  title: string;
  titleSource: SavedVideoTitleSource;
  question?: string;
  /** The lesson, or for an explain video `{ kind: "explain-video", topic, plan }`. */
  lesson: ExperimentLesson | ({ kind: typeof EXPLAIN_VIDEO_KIND } & Record<string, unknown>);
  video: Buffer;
  videoMime: string;
  poster?: Buffer;
  posterMime?: string;
  durationMs?: number;
}): Promise<SavedLessonVideo> {
  const supabase = getServiceSupabase();
  const id = crypto.randomUUID();
  const owner = input.userId?.trim() || "shared";
  const ext = input.videoMime.includes("mp4") ? "mp4" : "webm";
  const storagePath = `${owner}/${id}.${ext}`;
  const posterPath = input.poster
    ? `${owner}/${id}.jpg`
    : undefined;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, input.video, {
      contentType: input.videoMime,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  if (input.poster && posterPath) {
    await supabase.storage.from(BUCKET).upload(posterPath, input.poster, {
      contentType: input.posterMime || "image/jpeg",
      upsert: false,
    });
  }

  const { data, error } = await supabase
    .from("saved_lesson_videos")
    .insert({
      id,
      user_id: input.userId?.trim() || null,
      title: input.title,
      title_source: input.titleSource,
      question: input.question ?? null,
      lesson: input.lesson,
      storage_path: storagePath,
      poster_path: posterPath ?? null,
      mime_type: input.videoMime,
      duration_ms: input.durationMs ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const video = rowToVideo(data as Record<string, unknown>);
  const row = data as Record<string, unknown>;
  return {
    ...video,
    videoUrl: await signedUrl(String(row.storage_path)),
    posterUrl: await signedUrl(
      typeof row.poster_path === "string" ? row.poster_path : undefined,
    ),
  };
}

export async function listSavedLessonVideos(
  userId: string,
  kind: SavedVideoKind = "lesson",
  limit = 40,
): Promise<SavedLessonVideo[]> {
  const supabase = getServiceSupabase();
  const query = supabase
    .from("saved_lesson_videos")
    .select(COLUMNS)
    .eq("user_id", userId);
  const filtered =
    kind === EXPLAIN_VIDEO_KIND
      ? query.eq("lesson->>kind", EXPLAIN_VIDEO_KIND)
      : query.or(`lesson->>kind.is.null,lesson->>kind.neq.${EXPLAIN_VIDEO_KIND}`);
  const { data, error } = await filtered
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingRelation(error)) {
      console.warn(
        "[saved-videos] cloud table is missing; dashboard will use copies on this device",
      );
      return [];
    }
    throw error;
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  return Promise.all(
    rows.map(async (row) => ({
      ...rowToVideo(row),
      videoUrl: await signedUrl(String(row.storage_path)),
      posterUrl: await signedUrl(
        typeof row.poster_path === "string" ? row.poster_path : undefined,
      ),
    })),
  );
}

export async function getPublicExplainVideo(id: string): Promise<SavedLessonVideo | null> {
  if (!isSavedVideoId(id)) return null;
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("saved_lesson_videos")
    .select(COLUMNS)
    .eq("id", id)
    .eq("lesson->>kind", EXPLAIN_VIDEO_KIND)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    ...rowToVideo(row),
    videoUrl: await signedUrl(String(row.storage_path)),
    posterUrl: await signedUrl(
      typeof row.poster_path === "string" ? row.poster_path : undefined,
    ),
  };
}

export async function renameSavedLessonVideo(input: {
  userId: string;
  id: string;
  title: string;
}): Promise<SavedLessonVideo | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("saved_lesson_videos")
    .update({ title: input.title, title_source: "user" })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    ...rowToVideo(row),
    videoUrl: await signedUrl(String(row.storage_path)),
    posterUrl: await signedUrl(
      typeof row.poster_path === "string" ? row.poster_path : undefined,
    ),
  };
}

export async function deleteSavedLessonVideo(input: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("saved_lesson_videos")
    .delete()
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select("storage_path, poster_path")
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const row = data as Record<string, unknown>;
  const paths = [row.storage_path, row.poster_path].filter(
    (path): path is string => typeof path === "string" && path.length > 0,
  );
  if (paths.length) {
    await supabase.storage.from(BUCKET).remove(paths);
  }
  return true;
}
