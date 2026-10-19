import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { scanFrontendHealth } from "@/lib/frontend-health/scan";
import { normalizeScanTargetUrl } from "@/lib/frontend-health/targetUrl";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  /** Omit or empty to scan the built-in broken demo fixture. */
  targetUrl: z.string().optional().nullable(),
  useFixture: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to run a frontend health scan." },
        { status: 401 },
      );
    }

    const json = await request.json().catch(() => ({}));
    const body = bodySchema.parse(json);
    const useFixture = body.useFixture === true;
    const rawTarget = typeof body.targetUrl === "string" ? body.targetUrl : "";

    let targetUrl: string | undefined;
    if (!useFixture && rawTarget.trim()) {
      const normalized = normalizeScanTargetUrl(rawTarget);
      if (!normalized.ok) {
        return NextResponse.json({ error: normalized.error }, { status: 400 });
      }
      targetUrl = normalized.url;
    }

    const result = await scanFrontendHealth({
      targetUrl,
      useFixture: useFixture || !targetUrl,
    });

    return NextResponse.json({ scan: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            "Invalid scan request. Use Scan demo, or pass a full http(s) app URL.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: toUserFacingError(
          error,
          "Could not scan the frontend. Install Chromium (`npx playwright install chromium`) or set BROWSERBASE_API_KEY / BROWSERLESS_API_KEY and restart the server.",
        ),
      },
      { status: 400 },
    );
  }
}
