import { KOKORO_VOICES } from "@/lib/explainer-video/types";
import { voiceSamples, workerStatus } from "@/lib/explainer-video/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Line 1 of the script read in each of the 3 Kokoro voices. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 200) {
    return Response.json({ error: "Send hook line 1 (up to 200 characters)." }, { status: 400 });
  }
  const status = await workerStatus();
  if (!status.ready) {
    return Response.json({ error: `The video worker isn't set up here: ${status.missing.join(", ")}.` }, { status: 503 });
  }
  try {
    const { key, voices } = await voiceSamples(text, KOKORO_VOICES.map((v) => v.id));
    return Response.json({
      samples: voices.map((voice) => ({ voice, url: `/api/explainer-videos/voices/${key}/${voice}` })),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message || "Couldn't record the samples." }, { status: 500 });
  }
}
