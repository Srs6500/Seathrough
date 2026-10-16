import {
  createInstallationToken,
  getRepoContentsText,
  listInstallationRepos,
  type GithubRepoOption,
} from "@/lib/data-flow/githubApp";
import { listInstallationsForUser } from "@/lib/data-flow/installations";

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
        badge: hasTs ? "supported" : "later",
      };
    }
    if (hasReact) {
      return { stackLabel: `React · ${lang}`, badge: "later" };
    }
    if (deps.express || deps.fastify || deps.koa) {
      return {
        stackLabel: `Node · ${lang}`,
        badge: "later",
      };
    }
    if (hasTs || Object.keys(deps).length > 0) {
      return { stackLabel: `JavaScript · ${lang}`, badge: "later" };
    }
  } catch {
    return null;
  }
  return null;
}

function stackFromPythonFiles(requirements: string | null, pyproject: string | null): {
  stackLabel: string;
  badge: RepoStackBadge;
} | null {
  const blob = `${requirements ?? ""}\n${pyproject ?? ""}`.toLowerCase();
  if (!blob.trim()) return null;
  if (blob.includes("fastapi")) {
    return { stackLabel: "Python · FastAPI", badge: "later" };
  }
  if (blob.includes("django")) {
    return { stackLabel: "Python · Django", badge: "later" };
  }
  if (blob.includes("flask")) {
    return { stackLabel: "Python · Flask", badge: "later" };
  }
  return { stackLabel: "Python", badge: "later" };
}

export async function detectRepoStack(input: {
  token?: string;
  fullName: string;
  defaultBranch: string;
}): Promise<{ stackLabel: string; badge: RepoStackBadge }> {
  const [owner, repo] = input.fullName.split("/");
  if (!owner || !repo) {
    return { stackLabel: "Unknown", badge: "later" };
  }

  try {
    const pkg = await getRepoContentsText({
      token: input.token,
      owner,
      repo,
      path: "package.json",
      ref: input.defaultBranch,
    });
    if (pkg) {
      const fromPkg = stackFromPackageJson(pkg);
      if (fromPkg) return fromPkg;
    }

    const [requirements, pyproject] = await Promise.all([
      getRepoContentsText({
        token: input.token,
        owner,
        repo,
        path: "requirements.txt",
        ref: input.defaultBranch,
      }),
      getRepoContentsText({
        token: input.token,
        owner,
        repo,
        path: "pyproject.toml",
        ref: input.defaultBranch,
      }),
    ]);
    const py = stackFromPythonFiles(requirements, pyproject);
    if (py) return py;
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

/** List accessible repos with stack labels for the selector UI. */
export async function listReposWithStackForUser(
  userId: string,
  query: string,
  limit = 30,
): Promise<RepoWithStack[]> {
  const installs = await listInstallationsForUser(userId);
  const byId = new Map<number, GithubRepoOption & { installationId: number }>();
  for (const install of installs) {
    const repos = await listInstallationRepos(install.installationId);
    for (const repo of repos) {
      byId.set(repo.id, { ...repo, installationId: install.installationId });
    }
  }

  const q = query.trim().toLowerCase();
  let list = [...byId.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
  if (q) {
    list = list.filter((repo) => {
      const full = repo.fullName.toLowerCase();
      const name = full.split("/")[1] ?? full;
      return full.includes(q) || name.includes(q);
    });
  }
  list = list.slice(0, limit);

  // Token per installation (cache)
  const tokenByInstall = new Map<number, string>();
  async function tokenFor(installationId: number) {
    let t = tokenByInstall.get(installationId);
    if (!t) {
      t = await createInstallationToken(installationId);
      tokenByInstall.set(installationId, t);
    }
    return t;
  }

  return mapPool(list, 6, async (repo) => {
    const token = await tokenFor(repo.installationId);
    const stack = await detectRepoStack({
      token,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
    });
    const name = repo.fullName.split("/")[1] ?? repo.fullName;
    return {
      id: repo.id,
      fullName: repo.fullName,
      private: repo.private,
      defaultBranch: repo.defaultBranch,
      name,
      stackLabel: stack.stackLabel,
      badge: stack.badge,
    };
  });
}
