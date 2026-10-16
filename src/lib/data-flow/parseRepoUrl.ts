/** Parse a GitHub repo URL or owner/repo into { owner, repo, fullName, ref? }. */

export type ParsedRepoRef = {
  owner: string;
  repo: string;
  fullName: string;
  ref?: string;
};

export function parseGithubRepoInput(raw: string): ParsedRepoRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // owner/repo or owner/repo/tree/branch
  const bare = trimmed.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(?:tree|blob)\/([^/\s]+))?\/?$/,
  );
  if (bare && !trimmed.includes("://") && !trimmed.includes("github.com")) {
    return {
      owner: bare[1]!,
      repo: bare[2]!.replace(/\.git$/, ""),
      fullName: `${bare[1]}/${bare[2]!.replace(/\.git$/, "")}`,
      ref: bare[3],
    };
  }

  let url: URL;
  try {
    const withProto = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    url = new URL(withProto);
  } catch {
    return null;
  }

  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;

  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  if (!owner || !repo) return null;

  let ref: string | undefined;
  if (
    parts.length >= 4 &&
    (parts[2] === "tree" || parts[2] === "blob") &&
    parts[3]
  ) {
    ref = parts[3];
  }

  return { owner, repo, fullName: `${owner}/${repo}`, ref };
}
