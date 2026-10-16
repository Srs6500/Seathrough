import { readFile } from "node:fs/promises";
import path from "node:path";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { getLocalRun } from "@/lib/bug-analyzer/localRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read a source file from an active local run directory.
 * Query: fullName=owner/repo&path=relative/or/absolute/path
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const fullName = url.searchParams.get("fullName") ?? "";
  const rawPath = url.searchParams.get("path") ?? "";
  if (!fullName.includes("/") || !rawPath) {
    return Response.json(
      { error: "fullName and path are required." },
      { status: 400 },
    );
  }

  const run = getLocalRun(fullName);
  if (!run?.dir) {
    return Response.json(
      { error: "No local run directory for this repo. Start a run first." },
      { status: 404 },
    );
  }

  // Normalize webpack/absolute paths → relative to run dir
  let rel = rawPath.replace(/\\/g, "/");
  const markers = [
    run.dir.replace(/\\/g, "/") + "/",
    "/src/",
    "/app/",
    "/components/",
    "/lib/",
    "/pages/",
  ];
  for (const marker of markers) {
    const idx = rel.lastIndexOf(marker);
    if (idx >= 0) {
      if (marker === run.dir.replace(/\\/g, "/") + "/") {
        rel = rel.slice(idx + marker.length);
      } else {
        // keep from src/app/... if present
        const fromSrc = rel.indexOf("/src/");
        const fromApp = rel.indexOf("/app/");
        const fromComp = rel.indexOf("/components/");
        const cut = [fromSrc, fromApp, fromComp]
          .filter((n) => n >= 0)
          .sort((a, b) => a - b)[0];
        if (cut != null) rel = rel.slice(cut + 1);
      }
      break;
    }
  }
  // strip leading webpack-file prefixes
  rel = rel.replace(/^.*?(src\/|app\/|components\/|lib\/|pages\/)/, "$1");
  rel = rel.replace(/^\/+/, "");

  const abs = path.resolve(run.dir, rel);
  const root = path.resolve(run.dir);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return Response.json({ error: "Invalid path." }, { status: 400 });
  }

  try {
    const content = await readFile(abs, "utf8");
    return Response.json({
      path: rel,
      content,
      lineCount: content.split("\n").length,
    });
  } catch {
    // try basename search under common folders
    const base = path.basename(rel);
    const tryPaths = [
      path.join(run.dir, "src", "components", base),
      path.join(run.dir, "components", base),
      path.join(run.dir, "src", "app", base),
      path.join(run.dir, "app", base),
      path.join(run.dir, base),
    ];
    for (const candidate of tryPaths) {
      try {
        const content = await readFile(candidate, "utf8");
        const shown = path.relative(run.dir, candidate);
        return Response.json({
          path: shown,
          content,
          lineCount: content.split("\n").length,
        });
      } catch {
        /* next */
      }
    }
    return Response.json(
      { error: `File not found in run dir: ${rel}` },
      { status: 404 },
    );
  }
}
