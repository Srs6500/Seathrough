import { envPresence, getDeepgramConfig } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const presence = envPresence();
  if (!presence.DEEPGRAM_API_KEY) {
    return Response.json({ error: "Voice is not configured." }, { status: 503 });
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  if (!buffer.byteLength) {
    return Response.json({ error: "Couldn't hear that. Try again." }, { status: 400 });
  }
  if (buffer.byteLength > 5_000_000) {
    return Response.json({ error: "Couldn't hear that. Try again." }, { status: 400 });
  }

  try {
    const { apiKey, sttModel } = getDeepgramConfig();
    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model", sttModel);
    url.searchParams.set("smart_format", "true");
    url.searchParams.set("punctuate", "true");
    const contentType = request.headers.get("content-type") || "audio/webm";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
      },
      body: buffer,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Deepgram STT failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    const body = (await response.json()) as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{ transcript?: string }>;
        }>;
      };
    };
    const transcript =
      body.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!transcript) {
      return Response.json(
        { error: "Couldn't hear that. Try again." },
        { status: 400 },
      );
    }
    return Response.json({ transcript });
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(error, "Couldn't hear that. Try again."),
      },
      { status: 500 },
    );
  }
}
