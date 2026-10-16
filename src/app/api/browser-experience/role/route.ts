import { toUserFacingError } from "@/lib/errors/userFacing";
import { roleBodySchema } from "@/lib/browser-experience/schemas";
import {
  switchSessionRole,
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

  const parsed = roleBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Session not found" }, { status: 400 });
  }

  try {
    const session = await switchSessionRole(
      parsed.data.sessionId,
      parsed.data.role,
    );
    return Response.json({ session: toPublicSession(session) });
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "Could not switch to that lesson step.",
        ),
      },
      { status: 400 },
    );
  }
}
