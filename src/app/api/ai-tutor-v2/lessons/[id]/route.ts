import { proxyToTutorV2, readTutorError } from "@/lib/ai-tutor-v2/proxy";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^les_[A-Za-z0-9]+$/.test(id)) {
    return Response.json(
      { error: { code: "not_found", message: "Lesson not found." } },
      { status: 404 },
    );
  }

  const upstream = await proxyToTutorV2(`/api/v2/lessons/${id}`);
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
  return Response.json(await upstream.json());
}
