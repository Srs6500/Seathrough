import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { jobFile } from "@/lib/explainer-video/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A job's snapshot or finished video. Supports Range so the player can seek. */
export async function GET(request: Request, ctx: RouteContext<"/api/explainer-videos/jobs/[id]/files/[name]">) {
  const { id, name } = await ctx.params;
  const found = await jobFile(id, name);
  if (!found) return new Response("Not found", { status: 404 });
  const { size } = await stat(found.file);
  const download = new URL(request.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "Content-Type": found.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(found.file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(found.file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
