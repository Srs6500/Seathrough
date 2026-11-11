import {
  generateExcalidrawScene,
  SYSTEM_DESIGN_PACKS,
} from "@/lib/automatic-drawing/generatePlan";
import { envPresence } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { withLlmApi } from "@/lib/llm/withLlmApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withLlmApi(request, "system-design", async () => {
  try {
    const presence = envPresence();
    if (!presence.OPENAI_API_KEY && !presence.GROQ_API_KEY) {
      return Response.json(
        {
          error:
            "Add OPENAI_API_KEY (preferred) or GROQ_API_KEY to generate diagrams.",
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { description?: unknown };
    const description =
      typeof body.description === "string" ? body.description.trim() : "";

    if (!description) {
      return Response.json(
        { error: "Description is required" },
        { status: 400 },
      );
    }
    if (description.length > 800) {
      return Response.json(
        { error: "Description is too long (max 800 characters)" },
        { status: 400 },
      );
    }

    const drawing = await generateExcalidrawScene(description, {
      packs: [...SYSTEM_DESIGN_PACKS],
    });
    return Response.json({
      plan: drawing.plan,
      batches: drawing.batches,
    });
  } catch (error) {
    console.error("[system-design]", error);
    const message = toUserFacingError(error);
    const status =
      error instanceof Error && /required|too long|valid/i.test(error.message)
        ? 400
        : 500;
    return Response.json({ error: message }, { status });
  }
  });
}
