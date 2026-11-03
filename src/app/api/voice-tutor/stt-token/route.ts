import { envPresence, getDeepgramConfig } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** A token only has to be valid when the socket opens; keep it short-lived. */
const TOKEN_TTL_SECONDS = 120;

/**
 * Mint a short-lived Deepgram token so the browser can stream mic audio
 * straight to Deepgram. Keeps the API key on the server and takes this app's
 * functions out of the audio path (Vercel functions don't read request bodies
 * as they stream, which made the proxied live route wait for the whole turn).
 */
export async function POST(request: Request) {
  if (!envPresence().DEEPGRAM_API_KEY) {
    return Response.json({ error: "Voice is not configured." }, { status: 503 });
  }

  // Only hand tokens to this site's own pages.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Not allowed." }, { status: 403 });
  }

  const { apiKey, sttModel } = getDeepgramConfig();
  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[stt-token] grant failed (${res.status}) ${detail.slice(0, 200)}`);
      return Response.json({ error: "Voice is unavailable." }, { status: 502 });
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      return Response.json({ error: "Voice is unavailable." }, { status: 502 });
    }
    return Response.json(
      {
        token: body.access_token,
        expiresIn: body.expires_in ?? 30,
        model: sttModel,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.warn("[stt-token] grant error", error);
    return Response.json({ error: "Voice is unavailable." }, { status: 502 });
  }
}
