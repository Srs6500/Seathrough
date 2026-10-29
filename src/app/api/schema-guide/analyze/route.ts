import { withSeethroughDebug } from "@seethrough/debug/next";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";
import { analyzeSchemaFiles } from "@/lib/schema-guide/buildGuide";
import { fetchSchemaRepoFiles } from "@/lib/schema-guide/fetchRepo";
import type { UploadedFile } from "@/lib/schema-guide/types";
import {
  readVibeGithubSession,
  resolveVibeRepoAccess,
} from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  demo?: boolean;
  files?: UploadedFile[];
  fullName?: string;
  repo?: string;
};

export const POST = withSeethroughDebug(async (request) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    if (body.demo) {
      return Response.json({ guide: await analyzeSchemaFiles("demo") });
    }

    const parsed =
      parseGithubRepoInput(body.fullName ?? "") ||
      parseGithubRepoInput(body.repo ?? "");
    if (parsed) {
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
      const fetched = await fetchSchemaRepoFiles({
        token,
        fullName: parsed.fullName,
        ref,
      });
      const guide = await analyzeSchemaFiles(fetched.files);
      guide.title = fetched.fullName.split("/")[1] || fetched.fullName;
      return Response.json({ guide });
    }

    const guide = await analyzeSchemaFiles(body.files ?? []);
    return Response.json({ guide });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read that schema.";
    const needConnect =
      /private|grant access|not found|404/i.test(message);
    return Response.json(
      { error: message, needConnect },
      { status: needConnect ? 404 : 400 },
    );
  }
});
