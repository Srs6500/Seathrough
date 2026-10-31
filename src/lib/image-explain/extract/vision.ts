import OpenAI from "openai";
import { getVisionLlmConfig } from "@/lib/env";
import { imageExtractionModelSchema } from "@/lib/image-explain/schemas";
import type {
  ImageExtractAdapter,
  ImageExtractInput,
} from "@/lib/image-explain/extract/types";
import { toDataUrl } from "@/lib/image-explain/extract/types";
import type { ImageExtraction } from "@/lib/image-explain/types";

const SYSTEM = `You extract educational content from a screenshot or image for a tutoring app.
Return ONLY JSON:
{
  "kind": "problem" | "diagram" | "notes" | "code" | "table" | "other",
  "title": "short label",
  "text": "full transcribed text from the image, preserving equations and structure",
  "blocks": [{ "text": "...", "label": "optional section" }],
  "confidence": 0.0-1.0
}

Rules:
- Transcribe text accurately. For math, prefer BOTH a clear plain form and LaTeX:
  plain like "(1/2)x + (3/2)(x+1) - 1/4 = 5" plus LaTeX in parentheses if helpful.
- Always include a plain-text version of every equation (fractions as a/b) so a whiteboard can write it.
- Include multiple-choice options verbatim (A/B/C/D) with plain fractions.
- Prefer kind=problem for homework/exam questions, diagram for figures, notes for handwritten notes, code for source code, table for grids.
- Never invent missing options or numbers. If unreadable, say so in text.
- If the image is blank or unreadable, still return JSON with text explaining that.`;

export const visionExtractAdapter: ImageExtractAdapter = {
  id: "vision",
  label: "Vision model",
  async extract(input: ImageExtractInput): Promise<ImageExtraction> {
    const config = getVisionLlmConfig();
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    const dataUrl = toDataUrl(input.bytes, input.mimeType);
    const userText = [
      "Extract all readable content from this image for tutoring.",
      input.question?.trim()
        ? `Learner focus: ${input.question.trim()}`
        : "",
      input.fileName ? `File name: ${input.fileName}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const completion = await client.chat.completions.create(
      {
        model: config.model,
        temperature: 0.1,
        max_tokens: config.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      },
      { signal: input.signal },
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Vision extractor returned no content.");

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error("Vision extractor returned invalid JSON.");
    }

    const parsed = imageExtractionModelSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Vision extractor did not match the required schema.");
    }

    return {
      engine: "vision",
      kind: parsed.data.kind,
      title: parsed.data.title,
      text: parsed.data.text,
      blocks: parsed.data.blocks,
      confidence: parsed.data.confidence,
    };
  },
};
