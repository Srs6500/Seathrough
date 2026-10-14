import { generateExperimentFollowup } from "@/lib/experiment/generateScene";
import { envPresence } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const presence = envPresence();
    if (!presence.OPENAI_API_KEY && !presence.GROQ_API_KEY) {
      return Response.json(
        {
          error:
            "Add OPENAI_API_KEY (preferred) or GROQ_API_KEY to generate drawings.",
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const topic = clip(body.topic, 800);
    const title = clip(body.title, 80) || "Explanation";
    const ask = clip(body.ask, 180);
    const expect = clip(body.expect, 80);
    const answer = clip(body.answer, 400);
    const lastSay = clip(body.lastSay, 400);
    const mode = body.mode === "physics" ? "physics" : "tutor";
    if (!answer) {
      return Response.json({ error: "An answer is required." }, { status: 400 });
    }
    if (!ask) {
      return Response.json(
        { error: "Could not explain that. Try another question." },
        { status: 400 },
      );
    }

    const followup = await generateExperimentFollowup({
      topic: topic || title,
      title,
      ask,
      expect,
      answer,
      lastSay,
      mode,
    });
    return Response.json({ followup });
  } catch (error) {
    console.error("[experiment-react]", error);
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "Could not explain that. Try another question.",
        ),
      },
      { status: 500 },
    );
  }
}
