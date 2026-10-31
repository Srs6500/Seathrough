/**
 * Client helpers for "teach me about this picture" in Smart tutor:
 * shrink the image, identify it (vision), and optionally build a 3D model (Tripo).
 */

export type ImageIdentity = {
  subject: string;
  description: string;
  focusOptions: string[];
};

export type Model3dStatus = {
  status: string;
  progress: number;
  ready: boolean;
  error?: string;
};

const MAX_EDGE = 1600;

/**
 * Re-encode to JPEG (max 1600px edge): Tripo uploads accept JPEG/PNG only, and
 * smaller images keep the vision call fast. Falls back to the original file.
 */
export async function prepareLessonImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // JPEG has no alpha — paint white so transparent PNGs don't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function postImage<T>(url: string, image: File, signal?: AbortSignal): Promise<T> {
  const form = new FormData();
  form.append("image", image);
  const res = await fetch(url, { method: "POST", body: form, signal });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || "Something went wrong with that image.");
  return body;
}

export function identifyLessonImage(image: File, signal?: AbortSignal) {
  return postImage<ImageIdentity>("/api/voice-tutor/identify-image", image, signal);
}

export async function startModel3d(image: File, signal?: AbortSignal): Promise<string> {
  const { taskId } = await postImage<{ taskId: string }>("/api/model3d/create", image, signal);
  return taskId;
}

export type ThreeModel = ImageIdentity & { title: string; brief: string; code: string };

/** Free fallback: Three.js code for the sandboxed scene viewer (no Tripo needed). */
export function buildThreeModel(image: File, signal?: AbortSignal) {
  return postImage<ThreeModel>("/api/model3d/threejs", image, signal);
}

/** Fix a crashed model via the scene-explain repair agent. */
export async function repairThreeModel(input: {
  title: string;
  brief: string;
  code: string;
  error: string;
  attempt: number;
}): Promise<string> {
  const res = await fetch("/api/scene-explain/repair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `3D model of ${input.title}. ${input.brief}`.slice(0, 600),
      title: input.title.slice(0, 80),
      code: input.code,
      error: input.error.slice(0, 1200),
      attempt: input.attempt,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!res.ok || !body.code) throw new Error(body.error || "Couldn't fix the 3D model.");
  return body.code;
}

export function model3dFileUrl(taskId: string): string {
  return `/api/model3d/file?task=${encodeURIComponent(taskId)}`;
}

/**
 * Poll until the model is ready (resolves) or fails / times out (throws).
 * Tripo recommends ~2s polling and a ~5 minute ceiling.
 */
export async function waitForModel3d(
  taskId: string,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5 * 60_000) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const res = await fetch(`/api/model3d/status?task=${encodeURIComponent(taskId)}`, {
      signal: options.signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Partial<Model3dStatus>;
    if (body.error) throw new Error(body.error);
    if (!res.ok) throw new Error("Couldn't check the 3D model.");
    options.onProgress?.(body.progress ?? 0);
    if (body.ready) return;
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("The 3D model is taking too long. Try again or use the image as is.");
}
