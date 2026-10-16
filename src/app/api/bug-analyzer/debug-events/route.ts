import {
  buildDashboardData,
  collectorBaseUrl,
} from "@/lib/bug-analyzer/debugEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy local @seethrough/debug collector → dashboard payload.
 * Intentionally NOT wrapped with withSeethroughDebug — the dashboard polls
 * this every few seconds and wrapping it floods the timeline with itself.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
  const base = collectorBaseUrl();

  try {
    const healthRes = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!healthRes.ok) {
      return Response.json(
        buildDashboardData({
          events: [],
          collectorOk: false,
          collectorUrl: base,
          project: null,
          message: `Collector responded ${healthRes.status}. Is npm run dev running with @seethrough/debug?`,
        }),
      );
    }
    const health = (await healthRes.json()) as {
      project?: string | null;
    };

    const eventsRes = await fetch(`${base}/events?limit=${limit}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!eventsRes.ok) {
      return Response.json(
        buildDashboardData({
          events: [],
          collectorOk: false,
          collectorUrl: base,
          project: health.project ?? null,
          message: "Could not read /events from the debug collector.",
        }),
        { status: 502 },
      );
    }
    const body = (await eventsRes.json()) as { events?: unknown[] };
    const events = Array.isArray(body.events) ? body.events : [];

    return Response.json(
      buildDashboardData({
        events: events as Parameters<typeof buildDashboardData>[0]["events"],
        collectorOk: true,
        collectorUrl: base,
        project: health.project ?? null,
      }),
    );
  } catch {
    return Response.json(
      buildDashboardData({
        events: [],
        collectorOk: false,
        collectorUrl: base,
        project: null,
        message:
          "Debug collector is offline. Run npm run dev so @seethrough/debug can start on port 4319.",
      }),
    );
  }
}
