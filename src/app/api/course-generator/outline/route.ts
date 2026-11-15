import { NextResponse } from "next/server";
import { generateCourseOutline } from "@/lib/course-generator/outline";
import { IntakeAnswerSchema } from "@/lib/course-generator/types";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  topic: z.string().trim().min(1).max(500),
  answers: z.array(IntakeAnswerSchema).max(12).default([]),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter what you want to learn" },
      { status: 400 },
    );
  }

  try {
    const course = await generateCourseOutline({
      topic: parsed.data.topic,
      answers: parsed.data.answers,
    });
    return NextResponse.json({ course });
  } catch (error) {
    console.error("[course-generator/outline]", error);
    return NextResponse.json(
      { error: toUserFacingError(error) },
      { status: 500 },
    );
  }
}
