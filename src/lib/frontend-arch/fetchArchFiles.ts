import {
  getPublicRawText,
  getRepoBlobText,
  getRepoMeta,
  getRepoTree,
  type GithubTreeEntry,
} from "@/lib/data-flow/githubApp";
import { resolveImportPath } from "@/lib/data-flow/nextIndex";
import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";

const SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/i;

const IGNORE_DIR =
  /(^|\/)(node_modules|\.git|\.next|dist|build|out|coverage|\.turbo|\.vercel|vendor|__pycache__|\.cache)(\/|$)/i;

const IGNORE_FILE =
  /(\.(min|map|lock|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|webm|pdf|zip|gz)$)/i;

const MAX_FILE_BYTES = 120_000;
const MAX_FILES = 520;
const MAX_TOTAL_BYTES = 9_000_000;
const CONCURRENCY = 10;
const CLOSURE_ROUNDS = 8;

function shouldInclude(path: string, size: number | undefined): boolean {
  if (IGNORE_DIR.test(path)) return false;
  const base = path.split("/").pop() ?? path;
  if (IGNORE_FILE.test(base)) return false;
  const isManifest =
    base === "package.json" ||
    base === "tsconfig.json" ||
    base === "jsconfig.json";
  if (!isManifest && !SOURCE_EXT.test(path)) return false;
  if (typeof size === "number" && size > MAX_FILE_BYTES) return false;
  return true;
}

function isSeedPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  if (base === "package.json" || base === "tsconfig.json") return true;
  if (/(^|\/)app\/.*\/page\.(tsx|jsx|ts|js)$/.test(path)) return true;
  if (/(^|\/)app\/page\.(tsx|jsx|ts|js)$/.test(path)) return true;
  if (/(^|\/)pages\/(?!api\/).+\.(tsx|jsx)$/.test(path)) return true;
  if (/(^|\/)app\/.*\/route\.(ts|js)$/.test(path)) return true;
  if (/(^|\/)modules\/[^/]+\/(index|mode)\.(ts|tsx)$/.test(path)) return true;
  if (/(^|\/)components\/.+\.(tsx|jsx)$/.test(path)) return true;
  return false;
}

function seedScore(path: string): number {
  let s = 0;
  const base = path.split("/").pop() ?? path;
  if (base === "package.json") s += 50;
  if (base === "tsconfig.json") s += 40;
  if (/\/page\.(tsx|jsx)$/.test(path)) s += 30;
  if (/\/route\.(ts|js)$/.test(path)) s += 20;
  if (/(^|\/)modules\//.test(path)) s += 18;
  if (/(^|\/)components\//.test(path)) s += 12;
  if (/\.(tsx|jsx)$/.test(path)) s += 4;
  return s;
}

function extractImportSpecs(content: string): string[] {
  const specs: string[] = [];
  const re =
    /import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|export\s+[^'"]*\s+from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const spec = m[1] || m[2] || m[3];
    if (spec && (spec.startsWith(".") || spec.startsWith("@/"))) {
      specs.push(spec);
    }
  }
  return specs;
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

/**
 * Frontend-arch fetch: download a seed of pages/components, then chase
 * local/@ import targets from the full git tree until the closure closes
 * (or we hit a hard budget). This avoids false "unresolved import" when
 * the target file exists but was left out of a flat file cap.
 */
export async function fetchFrontendArchSourceFiles(input: {
  token?: string;
  fullName: string;
  ref?: string;
}): Promise<{
  fullName: string;
  ref: string;
  private: boolean;
  truncatedTree: boolean;
  closureComplete: boolean;
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

  const blobs = tree.tree.filter(
    (e): e is GithubTreeEntry & { type: "blob"; path: string; sha: string } =>
      e.type === "blob" &&
      Boolean(e.path) &&
      Boolean(e.sha) &&
      shouldInclude(e.path, e.size),
  );

  const pathSet = new Set(blobs.map((b) => b.path));
  const byPath = new Map(blobs.map((b) => [b.path, b]));

  const seedPaths = [
    ...blobs.filter((b) => isSeedPath(b.path)).map((b) => b.path),
    // Always pad with highest-scoring remaining paths so libs get a start
    ...blobs
      .slice()
      .sort((a, b) => seedScore(b.path) - seedScore(a.path))
      .map((b) => b.path),
  ];
  const uniqueSeed: string[] = [];
  const seenSeed = new Set<string>();
  for (const p of seedPaths) {
    if (seenSeed.has(p)) continue;
    seenSeed.add(p);
    uniqueSeed.push(p);
    if (uniqueSeed.length >= 220) break;
  }

  const files = new Map<string, RepoSourceFile>();
  let totalBytes = 0;
  const useRaw = !input.token;

  async function downloadPaths(paths: string[]): Promise<void> {
    const need = paths.filter((p) => !files.has(p) && byPath.has(p));
    if (!need.length) return;
    const room = MAX_FILES - files.size;
    const batch = need.slice(0, Math.max(0, room));
    if (!batch.length) return;

    const downloaded = await mapPool(batch, CONCURRENCY, async (path) => {
      const entry = byPath.get(path);
      if (!entry) return null;
      try {
        const content = useRaw
          ? await getPublicRawText({ owner, repo, ref, path })
          : await getRepoBlobText({
              token: input.token,
              owner,
              repo,
              sha: entry.sha,
            });
        if (content == null) return null;
        const size = Buffer.byteLength(content, "utf8");
        if (size > MAX_FILE_BYTES) return null;
        return { path, content, size };
      } catch {
        return null;
      }
    });

    for (const file of downloaded) {
      if (files.has(file.path)) continue;
      if (totalBytes + file.size > MAX_TOTAL_BYTES) return;
      totalBytes += file.size;
      files.set(file.path, file);
      if (files.size >= MAX_FILES) return;
    }
  }

  await downloadPaths(uniqueSeed);

  let closureComplete = false;
  for (let round = 0; round < CLOSURE_ROUNDS; round++) {
    if (files.size >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) break;

    const missing: string[] = [];
    const missingSet = new Set<string>();
    for (const file of files.values()) {
      for (const spec of extractImportSpecs(file.content)) {
        const resolved = resolveImportPath(file.path, spec, pathSet);
        if (!resolved) continue;
        if (files.has(resolved)) continue;
        if (!byPath.has(resolved)) continue;
        if (missingSet.has(resolved)) continue;
        missingSet.add(resolved);
        missing.push(resolved);
      }
    }

    if (!missing.length) {
      closureComplete = true;
      break;
    }
    await downloadPaths(missing);
  }

  // Final closure check
  if (!closureComplete) {
    let stillMissing = false;
    for (const file of files.values()) {
      for (const spec of extractImportSpecs(file.content)) {
        const resolved = resolveImportPath(file.path, spec, pathSet);
        if (resolved && byPath.has(resolved) && !files.has(resolved)) {
          stillMissing = true;
          break;
        }
      }
      if (stillMissing) break;
    }
    closureComplete = !stillMissing;
  }

  return {
    fullName: meta.fullName,
    ref,
    private: meta.private,
    // Only warn when GitHub truncated the tree or we couldn't finish import closure
    truncatedTree: tree.truncated || !closureComplete,
    closureComplete,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
