import { toUserFacingError } from "@/lib/errors/userFacing";
import { inputBodySchema } from "@/lib/browser-experience/schemas";
import { dispatchSessionInput } from "@/lib/browser-experience/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Session not found" }, { status: 400 });
  }

  const parsed = inputBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid browser input." }, { status: 400 });
  }

  try {
    await dispatchSessionInput(parsed.data.sessionId, parsed.data);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "Could not send that to the browser. Take control first.",
        ),
      },
      { status: 400 },
    );
  }
}
