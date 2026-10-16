import { generateExperimentLesson } from "@/lib/experiment/generateScene";
import { simpleShapeLesson } from "@/lib/experiment/scene";
import { mentionsSecantAndTangent } from "@/lib/experiment/graph";
import { parseIntakeAnswers } from "@/lib/experiment/systemDesign/answers";
import { generateSystemDesign } from "@/lib/experiment/systemDesign/generate";
import { systemDesignIntake } from "@/lib/experiment/systemDesign/sections";
import { envPresence } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      prompt?: unknown;
      answers?: unknown;
      mode?: unknown;
    };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (prompt.length > 800) {
      return Response.json(
        { error: "Prompt is too long (max 800 characters)" },
        { status: 400 },
      );
    }

    const systemPage = body.mode === "system";
    const physicsPage = body.mode === "physics";
    const branch = systemPage
      ? body.answers != null
        ? "design"
        : "intake"
      : "lesson";
    if (branch === "intake") {
      return Response.json({ intake: systemDesignIntake(prompt) });
    }

    const simple = simpleShapeLesson(prompt);
    if (
      branch === "lesson" &&
      !physicsPage &&
      simple &&
      !mentionsSecantAndTangent(prompt)
    ) {
      return Response.json({ lesson: simple });
    }

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

    if (branch === "design") {
      const parsed = parseIntakeAnswers(body.answers);
      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: 400 });
      }
      const { spec, lesson } = await generateSystemDesign(prompt, parsed.answers);
      return Response.json({ lesson, design: { spec } });
    }

    const lesson = await generateExperimentLesson(
      prompt,
      physicsPage ? { mode: "physics" } : { mode: "tutor" },
    );
    return Response.json({ lesson });
  } catch (error) {
    console.error("[experiment-draw]", error);
    const message = toUserFacingError(
      error,
      "Could not explain that. Try another question.",
    );
    const status =
      error instanceof Error && /required|too long/i.test(error.message)
        ? 400
        : 500;
    return Response.json({ error: message }, { status });
  }
}
