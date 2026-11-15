import type {
  CourseOutline,
  CourseUnit,
  CourseUnitContent,
  PriorUnitDigest,
} from "@/lib/course-generator/types";

/** Build a short digest from generated unit content for later units. */
export function digestFromContent(
  unit: Pick<CourseUnit, "title" | "objective" | "kind">,
  content: CourseUnitContent,
): string {
  if (content.kind === "whiteboard") {
    const says = content.data.plan.beats
      .map((b) => b.say.trim())
      .filter(Boolean)
      .slice(0, 6);
    return [
      `Whiteboard lesson "${unit.title}" (${unit.objective}).`,
      says.length ? `Covered: ${says.join(" · ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (content.kind === "writing") {
    const heads = content.data.sections.map((s) => s.heading).slice(0, 5);
    const takes = content.data.takeaways.slice(0, 3);
    return [
      `Notes "${content.data.title}": ${content.data.intro}`,
      heads.length ? `Sections: ${heads.join("; ")}.` : "",
      takes.length ? `Takeaways: ${takes.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const qs = content.data.items.map((q) => q.question).slice(0, 4);
  return [
    `Practice questions for "${unit.title}".`,
    qs.length ? `Asked: ${qs.join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Priors for unit at `unitIndex` — only ready units before it. */
export function priorDigestsForUnit(
  course: CourseOutline,
  unitIndex: number,
): PriorUnitDigest[] {
  return course.units
    .slice(0, Math.max(0, unitIndex))
    .filter((u) => u.status === "ready" && u.summary?.trim())
    .map((u) => ({
      order: u.order,
      kind: u.kind,
      title: u.title,
      objective: u.objective,
      summary: u.summary!.trim(),
    }));
}

export function formatPriorBlock(priors: PriorUnitDigest[]): string {
  if (priors.length === 0) {
    return "No prior units yet — this is the first piece of the course.";
  }
  return priors
    .map(
      (p, i) =>
        `${i + 1}. [${p.kind}] ${p.title} — ${p.objective}\n   ${p.summary}`,
    )
    .join("\n");
}
