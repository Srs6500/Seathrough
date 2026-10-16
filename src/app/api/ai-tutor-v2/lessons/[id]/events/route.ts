import { getAiTutorV2BaseUrl } from "@/lib/ai-tutor-v2/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxy the AI Tutor v2 SSE stream so the browser stays same-origin. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^les_[A-Za-z0-9]+$/.test(id)) {
    return Response.json(
      { error: { code: "not_found", message: "Lesson not found." } },
      { status: 404 },
    );
  }

  const incoming = new URL(request.url);
  const upstreamUrl = new URL(
    `${getAiTutorV2BaseUrl()}/api/v2/lessons/${id}/events`,
  );
  const cursor = incoming.searchParams.get("cursor");
  if (cursor) upstreamUrl.searchParams.set("cursor", cursor);

  const headers: HeadersInit = { Accept: "text/event-stream" };
  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers,
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "unavailable",
          message:
            "AI Tutor v2 is not reachable. Start the Python API on port 8000.",
        },
      },
      { status: 503 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      {
        error: {
          code: "upstream",
          message: `Could not open the lesson stream (${upstream.status}).`,
        },
      },
      { status: upstream.status },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
