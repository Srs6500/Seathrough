import { getUserFromRequest } from "@/lib/auth/requestUser";
import {
  explainErrorWithAi,
  type ExplainErrorInput,
} from "@/lib/bug-analyzer/explainError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: ExplainErrorInput;
  try {
    body = (await request.json()) as ExplainErrorInput;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.message && !body.path && !body.stack) {
    return Response.json(
      { error: "Provide at least an error message, stack, or request path." },
      { status: 400 },
    );
  }

  try {
    const result = await explainErrorWithAi({
      name: body.name,
      message: body.message,
      stack: body.stack?.slice(0, 6000),
      method: body.method,
      path: body.path,
      statusCode: body.statusCode,
      bodyPreview: body.bodyPreview?.slice(0, 800),
      sourceRefs: Array.isArray(body.sourceRefs)
        ? body.sourceRefs.slice(0, 10)
        : undefined,
      codeHints: Array.isArray(body.codeHints)
        ? body.codeHints.slice(0, 40)
        : undefined,
    });
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to explain error.";
    return Response.json({ error: message }, { status: 502 });
  }
}
