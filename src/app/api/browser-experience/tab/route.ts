import { toUserFacingError } from "@/lib/errors/userFacing";
import { tabBodySchema } from "@/lib/browser-experience/schemas";
import {
  activateSessionTab,
  closeSessionTab,
  navigateSessionOmnibox,
  openBlankSessionTab,
  reloadSessionTab,
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

  const parsed = tabBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid tab request" }, { status: 400 });
  }

  const { sessionId, action, tabId, url } = parsed.data;

  try {
    let session;
    if (action === "new") {
      session = await openBlankSessionTab(sessionId);
    } else if (action === "activate") {
      if (!tabId) {
        return Response.json({ error: "Tab not found" }, { status: 400 });
      }
      session = await activateSessionTab(sessionId, tabId);
    } else if (action === "close") {
      if (!tabId) {
        return Response.json({ error: "Tab not found" }, { status: 400 });
      }
      session = await closeSessionTab(sessionId, tabId);
    } else if (action === "navigate") {
      if (!url?.trim()) {
        return Response.json(
          { error: "Type a URL or search query." },
          { status: 400 },
        );
      }
      session = await navigateSessionOmnibox(sessionId, url);
    } else {
      session = await reloadSessionTab(sessionId);
    }
    return Response.json({ session: toPublicSession(session) });
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(error, "Could not update browser tabs."),
      },
      { status: 400 },
    );
  }
}
