/**
 * Tripo3D v3 client (server only): image → textured GLB.
 * Flow: POST /files (file_token) → POST /generation/image-to-model (task_id)
 * → poll GET /tasks/{task_id} until success → output.model_url.
 * Global endpoint is openapi.tripo3d.ai (openapi.tripo3d.com is the China region).
 * Docs: https://developers.tripo3d.com/en/docs/task-lifecycle
 */

import { getTripoConfig } from "@/lib/env";

export type TripoTaskStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "banned"
  | "expired"
  | "cancelled";

export type TripoTask = {
  taskId: string;
  status: TripoTaskStatus;
  progress: number;
  modelUrl?: string;
  previewUrl?: string;
  errorMessage?: string;
};

type TripoEnvelope<T> = { code?: number; message?: string; data?: T };

const TASK_ID_RE = /^task_[A-Za-z0-9_-]{1,120}$/;

export function isTripoTaskId(id: string): boolean {
  return TASK_ID_RE.test(id);
}

async function tripoFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey, baseURL } = getTripoConfig();
  const res = await fetch(`${baseURL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
    cache: "no-store",
  });
  let body: TripoEnvelope<T> = {};
  try {
    body = (await res.json()) as TripoEnvelope<T>;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || body.code !== 0 || !body.data) {
    throw new Error(
      `Tripo ${path} failed (${res.status}${body.code != null ? `, code ${body.code}` : ""})${body.message ? `: ${body.message.slice(0, 200)}` : ""}`,
    );
  }
  return body.data;
}

/** Upload a JPEG/PNG and start image → 3D. Returns the task id. */
export async function startImageToModel(image: {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }),
    image.fileName,
  );
  const { file_token } = await tripoFetch<{ file_token: string }>("/files", {
    method: "POST",
    body: form,
  });

  const { task_id } = await tripoFetch<{ task_id: string }>(
    "/generation/image-to-model",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: file_token,
        // Web-viewer budget: plenty of detail, still loads fast in the browser.
        face_limit: 40000,
        texture: true,
        pbr: true,
      }),
    },
  );
  return task_id;
}

export async function getImageToModelTask(taskId: string): Promise<TripoTask> {
  const data = await tripoFetch<{
    task_id: string;
    status: TripoTaskStatus;
    progress?: number;
    error_message?: string;
    output?: { model_url?: string; rendered_image_url?: string };
  }>(`/tasks/${encodeURIComponent(taskId)}`);
  return {
    taskId: data.task_id,
    status: data.status,
    progress: Math.max(0, Math.min(100, Math.round(data.progress ?? 0))),
    modelUrl: data.output?.model_url,
    previewUrl: data.output?.rendered_image_url,
    errorMessage: data.error_message,
  };
}

/** Available (unfrozen) credits; null when the balance can't be read. */
export async function getTripoBalance(): Promise<number | null> {
  try {
    const data = await tripoFetch<{ balance?: number }>("/account/balance");
    return typeof data.balance === "number" ? data.balance : null;
  } catch {
    return null;
  }
}

/**
 * The model URL always comes from Tripo's task response (never the client),
 * so https is the only check — CDN hostnames vary by region.
 */
export function isTripoAssetUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}
