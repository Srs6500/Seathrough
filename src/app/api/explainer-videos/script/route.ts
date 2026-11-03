import { toUserFacingError } from "@/lib/errors/userFacing";
import { scriptProblems, writeExplainerScript } from "@/lib/explainer-video/script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Topic (+ must-mentions) → a 30-60 s reel script for the person to approve. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { topic?: unknown; mustMention?: unknown } | null;
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  const mustMention = typeof body?.mustMention === "string" ? body.mustMention.trim() : "";
  if (topic.length < 2 || topic.length > 200) {
    return Response.json({ error: "Give a topic (up to 200 characters)." }, { status: 400 });
  }
  try {
    const script = await writeExplainerScript({ topic, mustMention: mustMention.slice(0, 500) });
    return Response.json({ script, warnings: scriptProblems(script) });
  } catch (err) {
    return Response.json({ error: toUserFacingError(err, "Couldn't write the script.") }, { status: 502 });
  }
}
