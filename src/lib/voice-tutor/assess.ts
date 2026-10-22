import type { ConceptBlock } from "@/lib/voice-tutor/schemas";

export type AssessResult = {
  understood: boolean;
  speech: string;
  matched: string[];
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s=]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Deterministic keyword rubric for v1. LLM judgment can wrap this later;
 * the orchestrator still owns progression.
 */
export function assessSpokenReasoning(
  block: ConceptBlock,
  answer: string,
): AssessResult {
  const rubric = block.assessment;
  if (!rubric) {
    return {
      understood: true,
      speech: "Thanks — let's keep going.",
      matched: [],
    };
  }

  const normalized = normalize(answer);
  if (!normalized) {
    return {
      understood: false,
      speech: rubric.hintSay,
      matched: [],
    };
  }

  const matched = rubric.expectKeywords.filter((keyword) =>
    normalized.includes(normalize(keyword)),
  );

  // Require at least one keyword hit; "no"/"not" alone is weak unless paired.
  const understood = matched.length >= 1;

  return {
    understood,
    speech: understood ? rubric.successSay : rubric.hintSay,
    matched,
  };
}
