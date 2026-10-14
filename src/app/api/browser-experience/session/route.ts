import { envPresence } from "@/lib/env";
import { preferredBrowserProvider } from "@/lib/browser-experience/openBrowser";
import { sessionBodySchema } from "@/lib/browser-experience/schemas";
import {
  destroySession,
  getSession,
  toPublicSession,
} from "@/lib/browser-experience/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId") || "";
  const presence = envPresence();
  if (!sessionId) {
    return Response.json({
      provider: preferredBrowserProvider(),
      configured: {
        llm: presence.GROQ_API_KEY || presence.OPENAI_API_KEY,
        tavily: presence.TAVILY_API_KEY,
        browserbase: presence.BROWSERBASE_API_KEY,
        browserless: presence.BROWSERLESS_API_KEY,
        voice: presence.DEEPGRAM_API_KEY,
      },
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  return Response.json({ session: toPublicSession(session) });
}

export async function DELETE(request: Request) {
  let json: unknown = {};
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const parsed = sessionBodySchema.safeParse(json);
  const sessionId =
    parsed.success && parsed.data.sessionId
      ? parsed.data.sessionId
      : new URL(request.url).searchParams.get("sessionId") || "";
  if (!sessionId) {
    return Response.json({ error: "Session not found" }, { status: 400 });
  }
  await destroySession(sessionId);
  return Response.json({ ok: true });
}
