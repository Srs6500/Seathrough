import { envPresence } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { synthesizeSpeech } from "@/lib/providers/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const presence = envPresence();
  if (!presence.DEEPGRAM_API_KEY) {
    return Response.json({ error: "Voice is not configured." }, { status: 503 });
  }

  let json: { text?: unknown } = {};
  try {
    json = (await request.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: "Nothing to speak." }, { status: 400 });
  }

  const text = typeof json.text === "string" ? json.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Nothing to speak." }, { status: 400 });
  }
  if (text.length > 900) {
    return Response.json({ error: "Nothing to speak." }, { status: 400 });
  }

  try {
    const spoken = await synthesizeSpeech(text, { mode: "tutor" });
    return Response.json(spoken);
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "Couldn't speak that line. The explanation is still on screen.",
        ),
      },
      { status: 500 },
    );
  }
}
