import { workerStatus } from "@/lib/explainer-video/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is the local render toolchain installed on the machine running the app? */
export async function GET() {
  return Response.json(await workerStatus());
}
