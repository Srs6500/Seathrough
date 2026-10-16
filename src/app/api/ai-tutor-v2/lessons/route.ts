import { proxyToTutorV2, readTutorError } from "@/lib/ai-tutor-v2/proxy";

export const runtime = "nodejs";

/** Create a lesson on the AI Tutor v2 service. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "invalid_request", message: "Expected JSON." } },
      { status: 400 },
    );
  }

  const upstream = await proxyToTutorV2("/api/v2/lessons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    return Response.json(
      {
        error: {
          code: "upstream",
          message: await readTutorError(upstream),
        },
      },
      { status: upstream.status },
    );
  }

  const created = (await upstream.json()) as {
    lesson_id: string;
    version_id: string;
    status: string;
    events_url: string;
  };

  return Response.json(
    {
      ...created,
      events_url: `/api/ai-tutor-v2/lessons/${created.lesson_id}/events`,
    },
    { status: 201 },
  );
}
