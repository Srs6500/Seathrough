import { getUserFromRequest } from "@/lib/auth/requestUser";
import {
  getRepoBlobText,
  getRepoMeta,
  getRepoTree,
  isGithubAppConfigured,
} from "@/lib/data-flow/githubApp";
import { resolveRepoAccess } from "@/lib/data-flow/installations";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE_RE =
  /\.(tsx?|jsx?|mjs|cjs|css|scss|sass|json|md|html?|vue|svelte)$/i;
const IGNORE_DIR =
  /(^|\/)(node_modules|\.git|\.next|dist|build|out|coverage|\.turbo|\.vercel)(\/|$)/i;

type Body = {
  fullName?: string;
  repo?: string;
  ref?: string;
  /** Optional: read one file's contents */
  path?: string;
};

async function resolveTokenAndRef(
  userId: string,
  fullName: string,
  preferredRef?: string,
): Promise<{ token?: string; ref: string; fullName: string }> {
  let token: string | undefined;
  let ref = preferredRef?.trim();

  if (isGithubAppConfigured()) {
    const access = await resolveRepoAccess(userId, fullName);
    if (access) {
      token = access.token;
      ref = ref || access.repo.defaultBranch;
    }
  }

  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error("Invalid repository name.");
  const meta = await getRepoMeta({ token, owner, repo });
  if (meta.private && !token) {
    throw new Error(
      "Private repo — connect GitHub and grant access before browsing files.",
    );
  }
  return {
    token,
    ref: ref || meta.defaultBranch,
    fullName: meta.fullName,
  };
}

/** List source files (or read one file) from a GitHub repo. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed =
    parseGithubRepoInput(body.repo ?? "") ||
    parseGithubRepoInput(body.fullName ?? "");
  if (!parsed) {
    return Response.json(
      { error: "Enter a GitHub repo as owner/repo." },
      { status: 400 },
    );
  }

  try {
    const resolved = await resolveTokenAndRef(
      user.id,
      parsed.fullName,
      body.ref || parsed.ref,
    );
    const [owner, repo] = resolved.fullName.split("/");
    if (!owner || !repo) {
      return Response.json({ error: "Invalid repository." }, { status: 400 });
    }

    const filePath = (body.path ?? "").trim();
    if (filePath) {
      const tree = await getRepoTree({
        token: resolved.token,
        owner,
        repo,
        ref: resolved.ref,
      });
      const entry = tree.tree.find(
        (e) => e.type === "blob" && e.path === filePath,
      );
      if (!entry) {
        return Response.json({ error: "File not found." }, { status: 404 });
      }
      const content = await getRepoBlobText({
        token: resolved.token,
        owner,
        repo,
        sha: entry.sha,
      });
      return Response.json({
        fullName: resolved.fullName,
        ref: resolved.ref,
        path: filePath,
        content,
      });
    }

    const tree = await getRepoTree({
      token: resolved.token,
      owner,
      repo,
      ref: resolved.ref,
    });
    const files = tree.tree
      .filter(
        (e) =>
          e.type === "blob" &&
          !IGNORE_DIR.test(e.path) &&
          SOURCE_RE.test(e.path),
      )
      .map((e) => ({
        path: e.path,
        size: e.size ?? 0,
        sha: e.sha,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 500);

    return Response.json({
      fullName: resolved.fullName,
      ref: resolved.ref,
      truncated: tree.truncated || files.length >= 500,
      files,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not list files.";
    return Response.json({ error: message }, { status: 502 });
  }
}
