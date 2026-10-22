/**
 * Small gold set for board annotation extraction (plan §C).
 * SQuAD-style: answer span must be an exact contiguous substring of the passage.
 */

export type AnnotationGoldExample = {
  topic: string;
  passage: string;
  annotations: Array<{
    targetPhrase: string;
    style: "circle" | "underline" | "both";
    sideNote: string;
    recallQuestion: string;
    examCue?: string;
  }>;
};

export const ANNOTATION_GOLD: AnnotationGoldExample[] = [
  {
    topic: "vertical line test",
    passage:
      "A graph represents a function if and only if no vertical line intersects the graph more than once. Each input x can pair with only one output y.",
    annotations: [
      {
        targetPhrase: "no vertical line intersects the graph more than once",
        style: "circle",
        sideNote: "When you see a graph, drag a vertical line — two hits means not a function.",
        recallQuestion:
          "How do you use a vertical line to decide if a graph is a function?",
        examCue: "State the vertical-line test for functions.",
      },
    ],
  },
  {
    topic: "photosynthesis",
    passage:
      "Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll in plant leaves captures sunlight to drive this process.",
    annotations: [
      {
        targetPhrase: "light energy into chemical energy",
        style: "both",
        sideNote: "Energy form changes: light in → sugar's chemical energy out.",
        recallQuestion: "What energy conversion happens in photosynthesis?",
      },
    ],
  },
  {
    topic: "World War II",
    passage:
      "World War II lasted from 1939 to 1945 and was fought between the Allies and the Axis powers. The war reshaped borders and led to the founding of the United Nations.",
    annotations: [
      {
        targetPhrase: "1939 to 1945",
        style: "underline",
        sideNote: "Anchor the conflict in that six-year window before naming causes.",
        recallQuestion: "In which years was World War II fought?",
      },
    ],
  },
];

/** Compact few-shot block for the lesson draft LLM prompt. */
export function annotationFewShotBlock(): string {
  const lines = ANNOTATION_GOLD.map((ex, i) => {
    const ann = ex.annotations[0]!;
    return `Example ${i + 1} (${ex.topic}):
passage: ${JSON.stringify(ex.passage)}
annotations: ${JSON.stringify([
      {
        targetPhrase: ann.targetPhrase,
        style: ann.style,
        sideNote: ann.sideNote,
        recallQuestion: ann.recallQuestion,
        examCue: ann.examCue,
      },
    ])}`;
  });
  return `Gold examples (SQuAD-style: targetPhrase MUST be copied verbatim from the passage; prefer short apply-units):
${lines.join("\n\n")}`;
}
