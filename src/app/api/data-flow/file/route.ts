import { getUserFromRequest } from "@/lib/auth/requestUser";
import {
  getRepoBlobText,
  getRepoTree,
  isGithubAppConfigured,
} from "@/lib/data-flow/githubApp";
import { resolveRepoAccess } from "@/lib/data-flow/installations";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200_000;

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isGithubAppConfigured()) {
    return Response.json(
      { error: "GitHub App is not configured." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const repoRaw = url.searchParams.get("repo") ?? url.searchParams.get("fullName") ?? "";
  const path = (url.searchParams.get("path") ?? "").replace(/^\/+/, "");
  const refParam = url.searchParams.get("ref") ?? undefined;

  const parsed = parseGithubRepoInput(repoRaw);
  if (!parsed || !path) {
    return Response.json(
      { error: "repo and path are required." },
      { status: 400 },
    );
  }
  if (path.includes("..")) {
    return Response.json({ error: "Invalid path." }, { status: 400 });
  }

  const access = await resolveRepoAccess(user.id, parsed.fullName);
  if (!access) {
    return Response.json(
      { error: "Repository not available on your GitHub installations." },
      { status: 404 },
    );
  }

  const [owner, repo] = access.repo.fullName.split("/");
  if (!owner || !repo) {
    return Response.json({ error: "Invalid repository." }, { status: 400 });
  }

  const ref = refParam?.trim() || parsed.ref || access.repo.defaultBranch;

  try {
    const tree = await getRepoTree({
      token: access.token,
      owner,
      repo,
      ref,
    });
    const entry = tree.tree.find((e) => e.type === "blob" && e.path === path);
    if (!entry) {
      return Response.json({ error: "File not found in repo tree." }, { status: 404 });
    }
    if (typeof entry.size === "number" && entry.size > MAX_BYTES) {
      return Response.json(
        { error: "File too large to preview." },
        { status: 413 },
      );
    }
    const content = await getRepoBlobText({
      token: access.token,
      owner,
      repo,
      sha: entry.sha,
    });
    if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
      return Response.json(
        { error: "File too large to preview." },
        { status: 413 },
      );
    }
    return Response.json({
      fullName: access.repo.fullName,
      ref,
      path,
      content,
      lineCount: content.split("\n").length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load file.";
    return Response.json({ error: message }, { status: 502 });
  }
}
