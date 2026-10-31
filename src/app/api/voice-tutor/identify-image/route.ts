import OpenAI from "openai";
import { getVisionLlmConfig } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { toDataUrl } from "@/lib/image-explain/extract/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8_000_000;

const SYSTEM = `You look at one image a student shared with a tutor and say what it shows.
Return ONLY JSON:
{
  "subject": "the main thing, 1-4 words, a clean concept name (e.g. \\"human heart\\", \\"DSLR camera\\", \\"Eiffel Tower\\")",
  "description": "1-2 plain sentences: what is visible, including notable parts, labels, or text",
  "focusOptions": ["3 short things worth learning about it, 2-5 words each"]
}
Rules:
- Name what is actually visible. If unsure, use a general but true subject ("electronic circuit board").
- focusOptions are real content angles (parts, how it works, history), never "general overview".
- Never invent text that isn't in the image.`;

/** Identify an image for Smart tutor: subject + description + focus angles. */
export async function POST(request: Request) {
  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get("image");
  } catch {
    /* handled below */
  }
  if (!(file instanceof File) || file.size <= 0) {
    return Response.json({ error: "Attach an image." }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type) || file.size > MAX_BYTES) {
    return Response.json(
      { error: "Use a JPEG, PNG, or WebP image under 8MB." },
      { status: 400 },
    );
  }

  try {
    const config = getVisionLlmConfig();
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    const completion = await client.chat.completions.create(
      {
        model: config.model,
        temperature: 0.2,
        max_tokens: Math.min(config.maxTokens, 600),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "What does this image show?" },
              {
                type: "image_url",
                image_url: {
                  url: toDataUrl(Buffer.from(await file.arrayBuffer()), file.type),
                },
              },
            ],
          },
        ],
      },
      { signal: request.signal },
    );
    const raw = JSON.parse(completion.choices[0]?.message?.content || "{}") as {
      subject?: unknown;
      description?: unknown;
      focusOptions?: unknown;
    };
    const subject =
      typeof raw.subject === "string" ? raw.subject.trim().slice(0, 60) : "";
    if (!subject) throw new Error("Vision model returned no subject.");
    return Response.json({
      subject,
      description:
        typeof raw.description === "string" ? raw.description.trim().slice(0, 400) : "",
      focusOptions: Array.isArray(raw.focusOptions)
        ? raw.focusOptions
            .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
            .map((o) => o.trim().slice(0, 48))
            .slice(0, 3)
        : [],
    });
  } catch (error) {
    console.error("[voice-tutor/identify-image]", error);
    return Response.json(
      { error: toUserFacingError(error, "Couldn't read that image. Try another one.") },
      { status: 502 },
    );
  }
}
