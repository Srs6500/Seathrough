import { withSeethroughDebug } from "@seethrough/debug/next";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";
import { fetchRepoSourceFiles } from "@/lib/data-flow/repoFiles";
import { runTreeSitterParse } from "@/lib/repo-scan/runTreeSitter";
import { sanitizeSandbox } from "@/lib/vibe-coder/sandbox";
import {
  readVibeGithubSession,
  resolveVibeRepoAccess,
} from "@/lib/vibe-coder/githubSession";
import type { VibeGuide } from "@/lib/vibe-coder/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  fullName?: string;
  repo?: string;
  sandbox?: {
    baseUrl?: string;
    apiUrl?: string;
    user?: string;
    password?: string;
  };
};

function isGuide(value: unknown): value is VibeGuide {
  return Boolean(value && typeof value === "object" && "features" in value);
}

export const POST = withSeethroughDebug(async (request) => {
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

  let token: string | undefined;
  let ref = parsed.ref;
  const session = readVibeGithubSession(request);
  if (session && isGithubAppConfigured()) {
    const access = await resolveVibeRepoAccess(session, parsed.fullName);
    if (access) {
      token = access.token;
      ref = ref || access.repo.defaultBranch;
    }
  }

  try {
    const fetched = await fetchRepoSourceFiles({
      token,
      fullName: parsed.fullName,
      ref,
    });
    const result = await runTreeSitterParse({
      fullName: fetched.fullName,
      ref: fetched.ref,
      truncated: fetched.truncatedTree,
      labelClusters: true,
      files: fetched.files.map((file) => ({
        path: file.path,
        content: file.content,
      })),
      sandbox: sanitizeSandbox(body.sandbox),
    });
    if (!isGuide(result.guide)) {
      return Response.json(
        { error: "The scan finished without a guide." },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, guide: result.guide });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read that repository.";
    const needConnect =
      /private|grant access|not found|404/i.test(message) && !token;
    return Response.json(
      { error: message, needConnect },
      { status: needConnect ? 404 : 502 },
    );
  }
});
