import type { RepoScanSandboxInput } from "@/lib/repo-scan/sandbox";
import type { TreeSitterParseResult } from "@/lib/repo-scan/types";

export type {
  FeatureTestResult,
  FeatureVerification,
  FileRelationshipGraph,
  TreeSitterParseResult,
} from "@/lib/repo-scan/types";

export async function parseGithubRepoWithTreeSitter(
  accessToken: string,
  fullName: string,
  ref?: string,
  sandbox?: RepoScanSandboxInput,
): Promise<TreeSitterParseResult> {
  const response = await fetch("/api/repo-scan/parse", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fullName, ref, sandbox }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (TreeSitterParseResult & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error || `Parse failed (${response.status}).`);
  }
  if (!body || body.ok === false) {
    throw new Error(body?.error || "Parse response missing result.");
  }
  return body;
}
