import { toUserFacingError } from "@/lib/errors/userFacing";
import { getImageToModelTask, isTripoTaskId } from "@/lib/model3d/tripo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Poll an image → 3D job: GET ?task=task_… */
export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("task") ?? "";
  if (!isTripoTaskId(taskId)) {
    return Response.json({ error: "Unknown 3D job." }, { status: 400 });
  }
  try {
    const task = await getImageToModelTask(taskId);
    const failed = ["failed", "banned", "expired", "cancelled"].includes(task.status);
    return Response.json(
      {
        status: task.status,
        progress: task.progress,
        ready: task.status === "success" && Boolean(task.modelUrl),
        error: failed
          ? task.status === "banned"
            ? "That image can't be turned into 3D. Try a different picture."
            : "The 3D model didn't finish. Try again or use the image as is."
          : undefined,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[model3d/status]", error);
    return Response.json(
      { error: toUserFacingError(error, "Couldn't check the 3D model.") },
      { status: 502 },
    );
  }
}
