import { getLiveIslandScript } from "@/lib/vibe-coder/liveIsland";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^[a-f0-9]{16,64}$/.test(key)) {
    return new Response("/* missing island */", {
      status: 400,
      headers: { "Content-Type": "text/javascript; charset=utf-8" },
    });
  }
  const js = getLiveIslandScript(key);
  if (!js) {
    return new Response("/* island expired */", {
      status: 404,
      headers: { "Content-Type": "text/javascript; charset=utf-8" },
    });
  }
  return new Response(js, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
