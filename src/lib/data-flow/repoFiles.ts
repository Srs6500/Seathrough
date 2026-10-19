import {
  getPublicRawText,
  getRepoBlobText,
  getRepoMeta,
  getRepoTree,
} from "@/lib/data-flow/githubApp";

export type RepoSourceFile = {
  path: string;
  content: string;
  size: number;
};

const SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|vue|svelte|html?|css|scss|sass|less|py|php|rb|go|java|kt|swift)$/i;

const IGNORE_DIR =
  /(^|\/)(node_modules|\.git|\.next|dist|build|out|coverage|\.turbo|\.vercel|vendor|__pycache__|\.cache|pods|deriveddata|storybook-static)(\/|$)/i;

const IGNORE_FILE =
  /(\.(min|map|lock|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|webm|pdf|zip|gz|tgz)$)|(^(package-lock|yarn\.lock|pnpm-lock|bun\.lockb)$)/i;

const MAX_FILES = 180;
const MAX_FILE_BYTES = 96_000;
const MAX_TOTAL_BYTES = 4_500_000;
const CONCURRENCY = 8;

function shouldInclude(path: string, size: number | undefined): boolean {
  if (IGNORE_DIR.test(path)) return false;
  const base = path.split("/").pop() ?? path;
  if (IGNORE_FILE.test(base)) return false;
  // Manifests needed for framework detection (Next/TS)
  const isManifest =
    base === "package.json" ||
    base === "tsconfig.json" ||
    base === "jsconfig.json";
  if (!isManifest && !SOURCE_EXT.test(path)) return false;
  if (typeof size === "number" && size > MAX_FILE_BYTES) return false;
  return true;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const result = await fn(items[idx]!);
      if (result != null) out.push(result);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

/** Download a capped set of source files from a GitHub repo. */
export async function fetchRepoSourceFiles(input: {
  /** Installation/user token. Omit for public repos (uses raw.githubusercontent.com for blobs). */
  token?: string;
  fullName: string;
  ref?: string;
  /** Override default file cap (e.g. frontend-arch needs more UI files). */
  maxFiles?: number;
}): Promise<{
  fullName: string;
  ref: string;
  private: boolean;
  truncatedTree: boolean;
  files: RepoSourceFile[];
}> {
  const [owner, repo] = input.fullName.split("/");
  if (!owner || !repo) {
    throw new Error("Invalid repository name. Expected owner/repo.");
  }

  const meta = await getRepoMeta({
    token: input.token,
    owner,
    repo,
  });
  if (meta.private && !input.token) {
    throw new Error(
      "This repository is private. Connect GitHub and grant access.",
    );
  }
  const ref = (input.ref || meta.defaultBranch).trim();
  const tree = await getRepoTree({
    token: input.token,
    owner,
    repo,
    ref,
  });

  const fileCap = Math.min(Math.max(input.maxFiles ?? MAX_FILES, 40), 400);
  const candidates = tree.tree
    .filter(
      (entry) =>
        entry.type === "blob" && shouldInclude(entry.path, entry.size),
    )
    .sort((a, b) => {
      // Prefer UI-ish paths first so cards stay useful when we hit the cap.
      const score = (path: string) => {
        let s = 0;
        const base = path.split("/").pop() ?? path;
        if (base === "package.json" || base === "tsconfig.json") s += 20;
        if (/(^|\/)(src|app|pages|components|ui|views|screens|modules)\//i.test(path))
          s += 3;
        if (/\.(tsx|jsx|vue|svelte)$/i.test(path)) s += 2;
        if (/(login|auth|search|form|nav|dashboard|checkout|profile)/i.test(path))
          s += 2;
        return s;
      };
      return score(b.path) - score(a.path) || a.path.localeCompare(b.path);
    })
    .slice(0, fileCap);

  const useRaw = !input.token;
  const downloaded = await mapPool(candidates, CONCURRENCY, async (entry) => {
    try {
      const content = useRaw
        ? await getPublicRawText({
            owner,
            repo,
            ref,
            path: entry.path,
          })
        : await getRepoBlobText({
            token: input.token,
            owner,
            repo,
            sha: entry.sha,
          });
      if (content == null) return null;
      const size = Buffer.byteLength(content, "utf8");
      if (size > MAX_FILE_BYTES) return null;
      return { path: entry.path, content, size };
    } catch {
      return null;
    }
  });

  const files: RepoSourceFile[] = [];
  let totalBytes = 0;
  for (const file of downloaded.sort((a, b) => a.path.localeCompare(b.path))) {
    if (totalBytes + file.size > MAX_TOTAL_BYTES) break;
    totalBytes += file.size;
    files.push(file);
  }

  return {
    fullName: meta.fullName,
    ref,
    private: meta.private,
    truncatedTree:
      tree.truncated ||
      candidates.length >= fileCap ||
      files.length < downloaded.length,
    files,
  };
}
