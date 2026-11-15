import { NextResponse } from "next/server";
import { generateIntakeQuestions } from "@/lib/course-generator/intake";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { topic?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = (body.topic ?? "").trim();
  if (!topic) {
    return NextResponse.json(
      { error: "Enter what you want to learn" },
      { status: 400 },
    );
  }
  if (topic.length > 500) {
    return NextResponse.json(
      { error: "Keep your request under 500 characters" },
      { status: 400 },
    );
  }

  try {
    const questions = await generateIntakeQuestions(topic);
    return NextResponse.json({ questions });
  } catch (error) {
    console.error("[course-generator/intake]", error);
    return NextResponse.json(
      { error: toUserFacingError(error) },
      { status: 500 },
    );
  }
}
