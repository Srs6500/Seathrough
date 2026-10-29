import { withSeethroughDebug } from "@seethrough/debug/next";
import { answerSchemaQuestion } from "@/lib/schema-guide/ask";
import { answerBackendQuestion } from "@/lib/schema-guide/backendAsk";
import type { SchemaGuide } from "@/lib/schema-guide/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  question?: string;
  guide?: SchemaGuide;
  scope?: "database" | "backend";
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
    return Response.json({ error: "Ask a question about the schema." }, { status: 400 });
  }
  if (!body.guide || !Array.isArray(body.guide.tables)) {
    return Response.json(
      { error: "Analyze a schema before asking." },
      { status: 400 },
    );
  }

  try {
    const result =
      body.scope === "backend"
        ? await answerBackendQuestion(question, body.guide)
        : await answerSchemaQuestion(question, body.guide);
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not answer that.";
    return Response.json({ error: message }, { status: 502 });
  }
});
