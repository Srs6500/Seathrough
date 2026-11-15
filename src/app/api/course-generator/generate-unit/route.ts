import { NextResponse } from "next/server";
import { priorDigestsForUnit } from "@/lib/course-generator/context";
import { generateCourseUnit } from "@/lib/course-generator/generateUnit";
import { CourseOutlineSchema } from "@/lib/course-generator/types";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  course: CourseOutlineSchema,
  unitId: z.string().min(1),
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
      { error: "A course and unit are required" },
      { status: 400 },
    );
  }

  const { course, unitId } = parsed.data;
  const index = course.units.findIndex((u) => u.id === unitId);
  if (index < 0) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  const unit = course.units[index]!;
  if (unit.content && unit.status === "ready") {
    return NextResponse.json({
      content: unit.content,
      summary: unit.summary ?? "",
    });
  }

  try {
    const generated = await generateCourseUnit({
      courseTitle: course.title,
      courseTopic: course.topic,
      unit,
      priors: priorDigestsForUnit(course, index),
    });
    return NextResponse.json(generated);
  } catch (error) {
    console.error("[course-generator/generate-unit]", error);
    return NextResponse.json(
      { error: toUserFacingError(error, "Couldn't generate that unit.") },
      { status: 500 },
    );
  }
}
