import { getUserFromRequest } from "@/lib/auth/requestUser";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { SmartTutorCloudSessionSchema } from "@/lib/voice-tutor/smartTutorCloud";
import {
  SmartTutorStoreMissing,
  listSmartTutorSessions,
  upsertSmartTutorSession,
} from "@/lib/voice-tutor/smartTutorSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json(
        { sessions: [], error: "Sign in required" },
        { status: 401 },
      );
    }
    return Response.json(
      { sessions: await listSmartTutorSessions(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SmartTutorStoreMissing) {
      return Response.json(
        { sessions: [], error: error.message, code: "store-missing" },
        { status: 503 },
      );
    }
    return Response.json(
      {
        sessions: [],
        error: toUserFacingError(error, "Could not load Smart tutor history."),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const wrapped =
      json && typeof json === "object" && "session" in (json as object)
        ? (json as { session: unknown }).session
        : json;
    const parsed = SmartTutorCloudSessionSchema.safeParse(wrapped);
    if (!parsed.success) {
      return Response.json(
        {
          error: "Invalid Smart tutor session",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    try {
      const session = await upsertSmartTutorSession(user.id, parsed.data);
      return Response.json(
        { session },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof Error && /too large/i.test(error.message)) {
        return Response.json({ error: error.message }, { status: 413 });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof SmartTutorStoreMissing) {
      return Response.json(
        { error: error.message, code: "store-missing" },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error: toUserFacingError(error, "Could not save Smart tutor history."),
      },
      { status: 500 },
    );
  }
}
