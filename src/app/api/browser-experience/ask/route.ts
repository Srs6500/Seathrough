import { envPresence } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { preferredBrowserProvider } from "@/lib/browser-experience/openBrowser";
import { askBodySchema } from "@/lib/browser-experience/schemas";
import { runBrowserAsk } from "@/lib/browser-experience/runAsk";
import { browserExperienceSseResponse } from "@/lib/browser-experience/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const presence = envPresence();
  if (!presence.GROQ_API_KEY && !presence.OPENAI_API_KEY) {
    return Response.json(
      { error: "Add GROQ_API_KEY or OPENAI_API_KEY to run the browser tutor." },
      { status: 503 },
    );
  }
  if (!presence.TAVILY_API_KEY) {
    return Response.json(
      { error: "Add TAVILY_API_KEY to search for credible sources." },
      { status: 503 },
    );
  }
  if (preferredBrowserProvider() === "none") {
    return Response.json(
      {
        error:
          "Add BROWSERLESS_API_KEY or BROWSERBASE_API_KEY to Vercel env to run Browser Experience in production. Local Chromium cannot start on this host.",
      },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  const parsed = askBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  return browserExperienceSseResponse(async (send) => {
    try {
      await runBrowserAsk({
        prompt: parsed.data.prompt,
        sessionId: parsed.data.sessionId,
        onEvent: send,
      });
    } catch (error) {
      throw new Error(
        toUserFacingError(
          error,
          "Could not start the browser lesson. Try again.",
        ),
      );
    }
  });
}
