import { toUserFacingError } from "@/lib/errors/userFacing";
import { controlBodySchema } from "@/lib/browser-experience/schemas";
import {
  requireSession,
  resumeSessionControl,
  takeSessionControl,
  toPublicSession,
} from "@/lib/browser-experience/sessionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Session not found" }, { status: 400 });
  }

  const parsed = controlBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Session not found" }, { status: 400 });
  }

  try {
    // refresh_live: no remint (Phase 0) — return current session for older clients.
    if (parsed.data.action === "refresh_live") {
      return Response.json({
        session: toPublicSession(requireSession(parsed.data.sessionId)),
      });
    }
    const session =
      parsed.data.action === "take"
        ? await takeSessionControl(parsed.data.sessionId, parsed.data.reason)
        : await resumeSessionControl(parsed.data.sessionId);
    return Response.json({ session: toPublicSession(session) });
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "Could not update browser control. Try again.",
        ),
      },
      { status: 400 },
    );
  }
}
