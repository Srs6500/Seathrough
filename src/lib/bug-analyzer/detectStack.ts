import {
  formatStackLabel,
  inferAppsFromPaths,
  isManifestPath,
  refineAppsFromManifests,
  stackBadge,
  type DetectedApp,
} from "@/lib/data-flow/discoverApps";
import {
  createInstallationToken,
  getPublicRawText,
  getRepoBlobText,
  getRepoContentsText,
  getRepoTree,
  listInstallationRepos,
  type GithubRepoOption,
  type GithubTreeEntry,
} from "@/lib/data-flow/githubApp";
import { listInstallationsForUser } from "@/lib/data-flow/installations";
import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";

export type RepoStackBadge = "supported" | "later";

export type RepoWithStack = GithubRepoOption & {
  name: string;
  stackLabel: string;
  badge: RepoStackBadge;
};

function depsOf(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

export function stackFromPackageJson(raw: string): {
  stackLabel: string;
  badge: RepoStackBadge;
} | null {
  try {
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = depsOf(pkg);
    const hasNext = Boolean(deps.next);
    const hasReact = Boolean(deps.react);
    const hasTs = Boolean(deps.typescript);
    const lang = hasTs ? "TypeScript" : "JavaScript";

    if (hasNext) {
      return {
        stackLabel: `Next.js · ${lang}`,
        badge: "supported",
      };
    }
    if (deps.vite || deps["@vitejs/plugin-react"]) {
      return { stackLabel: "Vite · React", badge: "supported" };
    }
    if (deps.express || deps.fastify || deps.koa) {
      return {
        stackLabel: `Node · Express`,
        badge: "supported",
      };
    }
    if (hasReact) {
      return { stackLabel: `React · ${lang}`, badge: "supported" };
    }
    if (hasTs || Object.keys(deps).length > 0) {
      return { stackLabel: `JavaScript · ${lang}`, badge: "later" };
    }
  } catch {
    return null;
  }
  return null;
}

function stackFromPythonFiles(
  requirements: string | null,
  pyproject: string | null,
): {
  stackLabel: string;
  badge: RepoStackBadge;
} | null {
  const blob = `${requirements ?? ""}\n${pyproject ?? ""}`.toLowerCase();
  if (!blob.trim()) return null;
  if (blob.includes("fastapi")) {
    return { stackLabel: "Python · FastAPI", badge: "supported" };
  }
  if (blob.includes("django")) {
    return { stackLabel: "Python · Django", badge: "later" };
  }
  if (blob.includes("flask")) {
    return { stackLabel: "Python · Flask", badge: "later" };
  }
  return { stackLabel: "Python", badge: "later" };
}

function depthOf(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function pickManifestEntries(
  tree: GithubTreeEntry[],
  pathApps: DetectedApp[],
): GithubTreeEntry[] {
  const blobs = tree.filter(
    (entry) =>
      entry.type === "blob" &&
      entry.path &&
      entry.sha &&
      isManifestPath(entry.path),
  );
  const sorted = blobs.sort(
    (a, b) =>
      depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path),
  );
  const pathEnough =
    pathApps.length > 0 && !pathApps.some((app) => app.kind === "python");
  if (pathEnough) return [];
  return sorted.slice(0, 8);
}

async function downloadManifests(input: {
  token?: string;
  owner: string;
  repo: string;
  ref: string;
  entries: GithubTreeEntry[];
}): Promise<RepoSourceFile[]> {
  const out: RepoSourceFile[] = [];
  for (const entry of input.entries) {
    try {
      const content = input.token
        ? await getRepoBlobText({
            token: input.token,
            owner: input.owner,
            repo: input.repo,
            sha: entry.sha,
          })
        : await getPublicRawText({
            owner: input.owner,
            repo: input.repo,
            ref: input.ref,
            path: entry.path,
          });
      if (!content) continue;
      out.push({
        path: entry.path,
        content,
        size: Buffer.byteLength(content, "utf8"),
      });
    } catch {
      // skip one missing manifest; others may still classify the repo
    }
  }
  return out;
}

async function detectFromRootContents(input: {
  token?: string;
  owner: string;
  repo: string;
  ref: string;
}): Promise<{ stackLabel: string; badge: RepoStackBadge } | null> {
  const pkg = await getRepoContentsText({
    token: input.token,
    owner: input.owner,
    repo: input.repo,
    path: "package.json",
    ref: input.ref,
  });
  if (pkg) {
    const fromPkg = stackFromPackageJson(pkg);
    if (fromPkg) return fromPkg;
  }

  const [requirements, pyproject] = await Promise.all([
    getRepoContentsText({
      token: input.token,
      owner: input.owner,
      repo: input.repo,
      path: "requirements.txt",
      ref: input.ref,
    }),
    getRepoContentsText({
      token: input.token,
      owner: input.owner,
      repo: input.repo,
      path: "pyproject.toml",
      ref: input.ref,
    }),
  ]);
  return stackFromPythonFiles(requirements, pyproject);
}

export function stackFromLanguage(
  language: string | null | undefined,
): { stackLabel: string; badge: RepoStackBadge } {
  const lang = (language || "").trim();
  if (!lang) return { stackLabel: "Unknown stack", badge: "later" };
  const key = lang.toLowerCase();
  if (key === "typescript" || key === "javascript") {
    return { stackLabel: lang, badge: "supported" };
  }
  if (key === "python") return { stackLabel: "Python", badge: "later" };
  if (key === "go") return { stackLabel: "Go", badge: "later" };
  return { stackLabel: lang, badge: "later" };
}

type StackHit = { stackLabel: string; badge: RepoStackBadge };
type CachedStack = {
  stack: StackHit;
  source: "fast" | "thorough";
  expiresAt: number;
};

const STACK_TTL_MS = 30 * 60 * 1000;
const stackCache = new Map<string, CachedStack>();

function stackCacheKey(fullName: string, ref: string): string {
  return `${fullName.trim().toLowerCase()}@${ref || "main"}`;
}

function cachedStack(fullName: string, ref: string): StackHit | null {
  const hit = stackCache.get(stackCacheKey(fullName, ref));
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.stack;
}

function rememberStack(
  fullName: string,
  ref: string,
  stack: StackHit,
  source: "fast" | "thorough",
) {
  const key = stackCacheKey(fullName, ref);
  const prev = stackCache.get(key);
  if (prev && prev.source === "thorough" && source === "fast") return;
  stackCache.set(key, {
    stack,
    source,
    expiresAt: Date.now() + STACK_TTL_MS,
  });
}

/** Root package.json / Python manifests only — one or two GitHub calls. */
export async function detectRepoStackFast(input: {
  token?: string;
  fullName: string;
  defaultBranch: string;
}): Promise<StackHit> {
  const cached = cachedStack(input.fullName, input.defaultBranch);
  if (cached) return cached;
  const [owner, repo] = input.fullName.split("/");
  if (!owner || !repo) {
    return { stackLabel: "Unknown", badge: "later" };
  }
  try {
    const fromRoot = await detectFromRootContents({
      token: input.token,
      owner,
      repo,
      ref: input.defaultBranch,
    });
    if (fromRoot) {
      rememberStack(input.fullName, input.defaultBranch, fromRoot, "fast");
      return fromRoot;
    }
  } catch {
    // keep the language fallback
  }
  return { stackLabel: "Unknown stack", badge: "later" };
}

export async function detectRepoStack(input: {
  token?: string;
  fullName: string;
  defaultBranch: string;
}): Promise<StackHit> {
  const cached = cachedStack(input.fullName, input.defaultBranch);
  if (cached) return cached;

  const [owner, repo] = input.fullName.split("/");
  if (!owner || !repo) {
    return { stackLabel: "Unknown", badge: "later" };
  }

  try {
    const tree = await getRepoTree({
      token: input.token,
      owner,
      repo,
      ref: input.defaultBranch,
    });
    const paths = tree.tree
      .filter((entry) => entry.type === "blob" && entry.path)
      .map((entry) => entry.path);
    const pathApps = inferAppsFromPaths(paths);
    const manifests = await downloadManifests({
      token: input.token,
      owner,
      repo,
      ref: input.defaultBranch,
      entries: pickManifestEntries(tree.tree, pathApps),
    });
    const apps = refineAppsFromManifests(manifests, pathApps);
    if (apps.length > 0) {
      const stack = {
        stackLabel: formatStackLabel(apps),
        badge: stackBadge(apps),
      };
      rememberStack(input.fullName, input.defaultBranch, stack, "thorough");
      return stack;
    }
  } catch {
    // fall through to root contents
  }

  try {
    const fromRoot = await detectFromRootContents({
      token: input.token,
      owner,
      repo,
      ref: input.defaultBranch,
    });
    if (fromRoot) {
      rememberStack(input.fullName, input.defaultBranch, fromRoot, "thorough");
      return fromRoot;
    }
  } catch {
    // fall through
  }

  return { stackLabel: "Unknown stack", badge: "later" };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

type InstalledRepo = GithubRepoOption & { installationId: number };

async function listInstalledRepos(
  userId: string,
  options?: { fresh?: boolean },
): Promise<InstalledRepo[]> {
  const installs = await listInstallationsForUser(userId);
  const batches = await Promise.all(
    installs.map(async (install) => {
      const repos = await listInstallationRepos(
        install.installationId,
        options,
      );
      return repos.map((repo) => ({
        ...repo,
        installationId: install.installationId,
      }));
    }),
  );
  const byId = new Map<number, InstalledRepo>();
  for (const repos of batches) {
    for (const repo of repos) byId.set(repo.id, repo);
  }
  return [...byId.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

function toRepoWithStack(repo: GithubRepoOption, stack: StackHit): RepoWithStack {
  return {
    id: repo.id,
    fullName: repo.fullName,
    private: repo.private,
    defaultBranch: repo.defaultBranch,
    language: repo.language,
    name: repo.fullName.split("/")[1] ?? repo.fullName,
    stackLabel: stack.stackLabel,
    badge: stack.badge,
  };
}

function labelForList(repo: GithubRepoOption): StackHit {
  return (
    cachedStack(repo.fullName, repo.defaultBranch) ??
    stackFromLanguage(repo.language)
  );
}

/**
 * Fast repo picker list.
 * Uses the installation catalog plus GitHub's language field.
 * Does not walk any repo tree — that is what made the picker take 10–20s.
 */
export async function listReposWithStackForUser(
  userId: string,
  query: string,
  limit = 100,
  options?: { fresh?: boolean },
): Promise<RepoWithStack[]> {
  const q = query.trim().toLowerCase();
  let list = await listInstalledRepos(userId, options);
  if (q) {
    list = list.filter((repo) => {
      const full = repo.fullName.toLowerCase();
      const name = full.split("/")[1] ?? full;
      const stack = labelForList(repo).stackLabel.toLowerCase();
      return full.includes(q) || name.includes(q) || stack.includes(q);
    });
  }
  return list.slice(0, limit).map((repo) => toRepoWithStack(repo, labelForList(repo)));
}

/** Cheap stack labels for the visible picker page (root manifests only). */
export async function enrichRepoStacksForUser(
  userId: string,
  fullNames: string[],
): Promise<RepoWithStack[]> {
  const wanted = [
    ...new Set(
      fullNames
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 20);
  if (wanted.length === 0) return [];

  const installed = await listInstalledRepos(userId);
  const list = installed.filter((repo) =>
    wanted.includes(repo.fullName.toLowerCase()),
  );
  if (list.length === 0) return [];

  return mapPool(list, 8, async (repo) => {
    const token = await createInstallationToken(repo.installationId);
    const stack = await detectRepoStackFast({
      token,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
    });
    const labeled =
      stack.stackLabel === "Unknown stack"
        ? stackFromLanguage(repo.language)
        : stack;
    return toRepoWithStack(repo, labeled);
  });
}
