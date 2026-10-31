import {
  getImageToModelTask,
  isTripoAssetUrl,
  isTripoTaskId,
} from "@/lib/model3d/tripo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stream a finished GLB: GET ?task=task_…
 * Proxied so the browser never needs Tripo CORS or a signed URL that expires.
 */
export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("task") ?? "";
  if (!isTripoTaskId(taskId)) {
    return new Response("Unknown 3D job.", { status: 400 });
  }
  try {
    const task = await getImageToModelTask(taskId);
    if (task.status !== "success" || !task.modelUrl || !isTripoAssetUrl(task.modelUrl)) {
      return new Response("Model not ready.", { status: 409 });
    }
    const upstream = await fetch(task.modelUrl, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return new Response("Couldn't load the model.", { status: 502 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[model3d/file]", error);
    return new Response("Couldn't load the model.", { status: 502 });
  }
}
