import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import { imageExplanationModelSchema } from "@/lib/image-explain/schemas";
import type {
  ImageExplanation,
  ImageExtraction,
} from "@/lib/image-explain/types";

const SYSTEM = `You are a careful tutor explaining a screenshot the student uploaded.
Return ONLY JSON:
{
  "title": "short lesson title",
  "summary": "2-4 sentences explaining what this is and the core idea",
  "steps": ["ordered teaching steps to understand / solve it"],
  "concepts": ["key concept labels"],
  "followUps": ["short questions the student could ask next"]
}

Rules:
- Ground the explanation in the extracted text. Do not invent unseen numbers/formulas.
- If the extract is incomplete, say what is unclear and teach from what is available.
- Keep steps concrete and student-friendly.`;

export async function explainExtraction(input: {
  extraction: ImageExtraction;
  question?: string;
  signal?: AbortSignal;
}): Promise<ImageExplanation> {
  const config = getLlmConfig();
  const client = getTrackedOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const blocks =
    input.extraction.blocks.length > 0
      ? input.extraction.blocks
          .map(
            (b, i) =>
              `[B${i + 1}${b.label ? ` ${b.label}` : ""}] ${b.text}`,
          )
          .join("\n")
      : "(no blocks)";

  const completion = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            `Image kind: ${input.extraction.kind}`,
            `Title hint: ${input.extraction.title}`,
            `Extractor: ${input.extraction.engine}`,
            input.question?.trim()
              ? `Student question: ${input.question.trim()}`
              : "Student question: Explain this image clearly.",
            `Extracted text:\n${input.extraction.text}`,
            `Blocks:\n${blocks}`,
          ].join("\n\n"),
        },
      ],
    },
    { signal: input.signal },
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Image explainer returned no content.");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Image explainer returned invalid JSON.");
  }

  const parsed = imageExplanationModelSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Image explainer did not match the required schema.");
  }

  return parsed.data;
}
