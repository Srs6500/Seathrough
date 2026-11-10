import { getUserFromRequest } from "@/lib/auth/requestUser";
import { toUserFacingError } from "@/lib/errors/userFacing";
import {
  SmartTutorStoreMissing,
  deleteSmartTutorSession,
  getSmartTutorSession,
} from "@/lib/voice-tutor/smartTutorSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }
    const { id } = await context.params;
    const session = await getSmartTutorSession({ userId: user.id, id });
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    return Response.json(
      { session },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SmartTutorStoreMissing) {
      return Response.json(
        { error: error.message, code: "store-missing" },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error: toUserFacingError(error, "Could not load this Smart tutor session."),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }
    const { id } = await context.params;
    await deleteSmartTutorSession({ userId: user.id, id });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof SmartTutorStoreMissing) {
      return Response.json(
        { error: error.message, code: "store-missing" },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error: toUserFacingError(error, "Could not delete this Smart tutor session."),
      },
      { status: 500 },
    );
  }
}
