import assert from "node:assert/strict";
import { digestFromContent, priorDigestsForUnit } from "../src/lib/course-generator/context";
import type { CourseOutline } from "../src/lib/course-generator/types";
import { getMode } from "../src/modes/registry";

assert.equal(getMode("course-generator")?.href, "/course-generator");
assert.equal(getMode("course-generator")?.enabled, true);

const writingDigest = digestFromContent(
  {
    title: "Notes",
    objective: "Summarize recursion",
    kind: "writing",
  },
  {
    kind: "writing",
    data: {
      title: "Recursion notes",
      intro: "Recursion means a function calls itself.",
      sections: [
        { heading: "Base case", body: "Stop when the input is small." },
        { heading: "Recursive case", body: "Break the problem down." },
      ],
      takeaways: ["Need a base case", "Trust the recursive call"],
    },
  },
);
assert.match(writingDigest, /Recursion notes/);
assert.match(writingDigest, /Base case/);

const course: CourseOutline = {
  id: "course_test",
  title: "Recursion",
  description: "Learn recursion",
  topic: "recursion",
  createdAt: 1,
  updatedAt: 1,
  intakeAnswers: [],
  units: [
    {
      id: "u1",
      order: 0,
      kind: "whiteboard",
      title: "Intro",
      objective: "Define recursion",
      status: "ready",
      summary: "Defined recursion with a base case.",
    },
    {
      id: "u2",
      order: 1,
      kind: "writing",
      title: "Notes",
      objective: "Write notes",
      status: "pending",
    },
  ],
};

const priors = priorDigestsForUnit(course, 1);
assert.equal(priors.length, 1);
assert.equal(priors[0]?.title, "Intro");
assert.equal(priorDigestsForUnit(course, 0).length, 0);

console.log("course-generator smoke checks passed");
