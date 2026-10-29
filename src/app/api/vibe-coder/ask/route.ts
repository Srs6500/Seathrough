import { withSeethroughDebug } from "@seethrough/debug/next";
import { runVibeAsk } from "@/lib/vibe-coder/runAsk";
import type { VibeGuide } from "@/lib/vibe-coder/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  question?: string;
  guide?: VibeGuide;
};

export const POST = withSeethroughDebug(async (request) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = String(body.question || "").trim();
  if (!question) {
    return Response.json({ error: "Ask a question about the app." }, { status: 400 });
  }
  if (!body.guide || !Array.isArray(body.guide.features)) {
    return Response.json(
      { error: "Scan a repository before asking." },
      { status: 400 },
    );
  }

  try {
    const result = await runVibeAsk(question, body.guide);
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not answer that.";
    return Response.json({ error: message }, { status: 502 });
  }
});
