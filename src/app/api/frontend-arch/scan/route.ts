import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/requestUser";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { isGithubAppConfigured } from "@/lib/data-flow/githubApp";
import { resolveRepoAccess } from "@/lib/data-flow/installations";
import { parseGithubRepoInput } from "@/lib/data-flow/parseRepoUrl";
import { buildFrontendArchitecture } from "@/lib/frontend-arch/buildArchitecture";
import { fetchFrontendArchSourceFiles } from "@/lib/frontend-arch/fetchArchFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const bodySchema = z.object({
  fullName: z.string().min(3),
  ref: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to scan frontend architecture." },
        { status: 401 },
      );
    }
    if (!isGithubAppConfigured()) {
      return NextResponse.json(
        { error: "GitHub App is not configured." },
        { status: 503 },
      );
    }

    const json = await request.json().catch(() => ({}));
    const body = bodySchema.parse(json);
    const parsed = parseGithubRepoInput(body.fullName);
    if (!parsed) {
      return NextResponse.json(
        { error: "Enter a valid owner/repo." },
        { status: 400 },
      );
    }

    const access = await resolveRepoAccess(user.id, parsed.fullName);
    if (!access) {
      return NextResponse.json(
        {
          error:
            "Repository not available. Connect GitHub and grant access to this repo.",
          needConnect: true,
        },
        { status: 404 },
      );
    }

    const fetched = await fetchFrontendArchSourceFiles({
      token: access.token,
      fullName: access.repo.fullName,
      ref: body.ref?.trim() || parsed.ref || access.repo.defaultBranch,
    });

    const scan = buildFrontendArchitecture({
      files: fetched.files,
      fullName: access.repo.fullName,
      ref: fetched.ref,
      // Only incomplete when import closure couldn't finish (or GitHub tree truncated)
      truncated: fetched.truncatedTree,
    });

    return NextResponse.json({
      scan: {
        ...scan,
        warnings: [
          ...scan.warnings,
          fetched.closureComplete
            ? ""
            : "Import closure hit the download budget; a few links may still be missing.",
        ].filter(Boolean),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid scan request." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: toUserFacingError(
          error,
          "Could not build the frontend architecture map.",
        ),
      },
      { status: 400 },
    );
  }
}
