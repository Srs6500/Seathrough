import {
  getPublicRawText,
  getRepoBlobText,
  getRepoMeta,
  getRepoTree,
} from "@/lib/data-flow/githubApp";
import type { UploadedFile } from "@/lib/schema-guide/types";

const IGNORE_DIR =
  /(^|\/)(node_modules|\.git|\.next|dist|build|out|coverage|\.turbo|vendor|venv|\.venv|__pycache__|site-packages)(\/|$)/i;
const PRISMA_FILE = /\.prisma$/i;
const SOURCE_FILE = /\.(ts|tsx|js|jsx|py|sql|rb|prisma)$/i;
const MAX_FILES = 70;
const MAX_FILE_BYTES = 80_000;
const CONCURRENCY = 8;

function isSchemaLike(path: string): boolean {
  return (
    PRISMA_FILE.test(path) ||
    /\.sql$/i.test(path) ||
    /(^|\/)models\.py$/i.test(path) ||
    /(^|\/)models\/.+\.py$/i.test(path) ||
    /(^|\/)schema\.rb$/i.test(path) ||
    /(^|\/)(drizzle|db|database)\/.*schema.*\.(ts|js)$/i.test(path) ||
    /(^|\/)schema\.(ts|js)$/i.test(path)
  );
}

function isPage(path: string): boolean {
  return (
    /(^|\/)(?:src\/)?app\/(?:.*\/)?page\.(tsx|jsx)$/i.test(path) ||
    (/(^|\/)(?:src\/)?pages\/.+\.(tsx|jsx)$/i.test(path) && !/\/api\//i.test(path)) ||
    /(^|\/)(?:src\/)?(views|screens)\/.+\.(tsx|jsx)$/i.test(path) ||
    /(^|\/)routes\/.+\.(tsx|jsx)$/i.test(path) ||
    /(^|\/)App\.(tsx|jsx)$/i.test(path) ||
    /Page\.(tsx|jsx)$/i.test(path) ||
    /Screen\.(tsx|jsx)$/i.test(path)
  );
}

function score(path: string): number {
  if (/schema\.prisma$/i.test(path)) return 100;
  if (PRISMA_FILE.test(path)) return 90;
  if (isSchemaLike(path)) return 84;
  if (isPage(path)) return 74;
  if (/(^|\/)components\/.+\.(tsx|jsx)$/i.test(path)) return 40;
  if (/\.(tsx|jsx)$/i.test(path)) return 32;
  if (/\.py$/i.test(path) && /(views|routers|api|models)/i.test(path)) return 36;
  if (/(^|\/)(app|routes|pages|components)\//i.test(path)) return 28;
  if (/(^|\/)(src|app|lib|server|prisma|db)\//i.test(path)) return 20;
  return 10;
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

export async function fetchSchemaRepoFiles(input: {
  token?: string;
  fullName: string;
  ref?: string;
}): Promise<{ fullName: string; files: UploadedFile[] }> {
  const [owner, repo] = input.fullName.split("/");
  if (!owner || !repo) {
    throw new Error("Enter a GitHub repo as owner/repo.");
  }

  const meta = await getRepoMeta({ token: input.token, owner, repo });
  if (meta.private && !input.token) {
    throw new Error("This repository is private. Connect GitHub and grant access.");
  }
  const ref = (input.ref || meta.defaultBranch).trim();
  const tree = await getRepoTree({ token: input.token, owner, repo, ref });
  const candidates = tree.tree
    .filter((entry) => {
      if (entry.type !== "blob" || !entry.path || IGNORE_DIR.test(entry.path)) {
        return false;
      }
      if (!SOURCE_FILE.test(entry.path) && !isSchemaLike(entry.path)) {
        return false;
      }
      if (typeof entry.size === "number" && entry.size > MAX_FILE_BYTES) {
        return false;
      }
      return true;
    })
    .sort((a, b) => score(b.path) - score(a.path) || a.path.localeCompare(b.path));

  if (candidates.length === 0) {
    throw new Error("We could not find app or database files in this repository.");
  }

  const schemaFiles = candidates.filter((entry) => isSchemaLike(entry.path)).slice(0, 16);
  const pages = candidates.filter((entry) => isPage(entry.path)).slice(0, 28);
  const rest = candidates.filter(
    (entry) => !isSchemaLike(entry.path) && !isPage(entry.path),
  );
  const picked = [...schemaFiles, ...pages, ...rest].slice(0, MAX_FILES);

  const useRaw = !input.token;
  const readEntry = async (entry: (typeof candidates)[number]) => {
    try {
      const content = useRaw
        ? await getPublicRawText({ owner, repo, ref, path: entry.path })
        : await getRepoBlobText({
            token: input.token,
            owner,
            repo,
            sha: entry.sha,
          });
      if (!content?.trim() || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
        return null;
      }
      return { path: entry.path, content };
    } catch {
      return null;
    }
  };

  const files = await mapPool(picked, CONCURRENCY, readEntry);

  const have = new Set(files.map((file) => file.path));
  let frontier = files.filter((file) => /\.(tsx|jsx)$/i.test(file.path));
  for (let depth = 0; depth < 3 && frontier.length; depth += 1) {
    const extras: typeof candidates = [];
    for (const file of frontier) {
      const imports = file.content.matchAll(/from\s+['"]([^'"]+)['"]/g);
      for (const item of imports) {
        const spec = item[1] ?? "";
        if (!spec.startsWith(".") && !spec.startsWith("@/") && !spec.startsWith("~/")) continue;
        const dir = file.path.split("/").slice(0, -1).join("/");
        const resolved = spec.startsWith(".")
          ? `${dir}/${spec}`.replace(/\/\.\//g, "/").replace(/[^/]+\/\.\.\//g, "")
          : spec.replace(/^@\//, "").replace(/^~\//, "");
        const match = candidates.find((entry) => {
          const path = entry.path.replace(/\.(tsx|jsx|ts|js)$/i, "");
          return (
            path === resolved ||
            path.endsWith(`/${resolved}`) ||
            entry.path.startsWith(`${resolved}.`) ||
            entry.path.startsWith(`${resolved}/index.`)
          );
        });
        if (match && !have.has(match.path) && extras.length < 24) {
          have.add(match.path);
          extras.push(match);
        }
      }
    }
    if (!extras.length) break;
    const more = await mapPool(extras, CONCURRENCY, readEntry);
    files.push(...more);
    frontier = more.filter((file) => /\.(tsx|jsx)$/i.test(file.path));
  }

  if (files.length === 0) {
    throw new Error("We could not read files from this repository.");
  }

  return { fullName: meta.fullName, files };
}
