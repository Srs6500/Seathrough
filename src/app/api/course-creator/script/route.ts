import { z } from "zod";
import { generateLessonScript, scriptWriterMissing } from "@/lib/course-creator/generate";
import { PROMPT_MAX } from "@/lib/course-creator/script";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX),
});

export async function POST(request: Request) {
  if (scriptWriterMissing()) {
    return Response.json(
      { error: "The script writer is not configured yet." },
      { status: 500 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Enter what this lesson should teach (1–800 characters)." },
      { status: 400 },
    );
  }

  try {
    const script = await generateLessonScript(parsed.data.prompt);
    return Response.json(script);
  } catch (error) {
    console.error(
      "[course-creator] script failed",
      error instanceof Error ? error.message : "error",
    );
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "The script could not be written. Try again in a moment.",
        ),
      },
      { status: 500 },
    );
  }
}
