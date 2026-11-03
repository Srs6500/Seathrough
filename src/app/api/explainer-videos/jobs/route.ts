import { repairScript, scriptProblems } from "@/lib/explainer-video/script";
import { KOKORO_VOICES, scriptSchema } from "@/lib/explainer-video/types";
import { createJob, workerStatus } from "@/lib/explainer-video/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Approved script + voice + orientation → start building the preview. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    script?: unknown;
    voice?: unknown;
    orientation?: unknown;
  } | null;
  const parsed = scriptSchema.safeParse(body?.script);
  if (!parsed.success) {
    return Response.json({ error: "The script has missing or too-long fields." }, { status: 400 });
  }
  const voice = KOKORO_VOICES.find((v) => v.id === body?.voice)?.id;
  const orientation = body?.orientation === "horizontal" ? "horizontal" : body?.orientation === "vertical" ? "vertical" : null;
  if (!voice || !orientation) {
    return Response.json({ error: "Pick a voice and an orientation." }, { status: 400 });
  }
  const status = await workerStatus();
  if (!status.ready) {
    return Response.json({ error: `The video worker isn't set up here: ${status.missing.join(", ")}.` }, { status: 503 });
  }
  const script = repairScript(parsed.data);
  const job = await createJob({ script, voice, orientation });
  return Response.json({ job, warnings: scriptProblems(script) });
}
