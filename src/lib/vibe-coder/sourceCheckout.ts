import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { findDevApp } from "@/lib/bug-analyzer/detectDevApp";

export type SourceTree = {
  fullName: string;
  dir: string;
  appRoot: string;
  relativeRoot: string;
};

const globalKey = "__seethrough_source_trees__";

function store(): Map<string, SourceTree | Promise<SourceTree>> {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, SourceTree | Promise<SourceTree>>;
  };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

function keyOf(fullName: string): string {
  return fullName.trim().toLowerCase();
}

function slugOf(fullName: string): string {
  return fullName.replace(/[^\w.-]+/g, "-");
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function downloadTarball(input: {
  token?: string;
  owner: string;
  repo: string;
  ref: string;
  destFile: string;
}): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Seethrough-source-pages",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/tarball/${encodeURIComponent(input.ref)}`;
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(
      response.status === 404
        ? "Repo not found or not accessible."
        : `Could not download the repository (${response.status}).`,
    );
  }
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(input.destFile),
  );
}

function extractTar(tarball: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "tar",
      ["-xzf", tarball, "-C", dest, "--strip-components=1"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Could not extract the repository archive."));
    });
  });
}

async function treeFromDir(fullName: string, dir: string): Promise<SourceTree | null> {
  const app = await findDevApp(dir);
  const appRoot = app?.appRoot ?? dir;
  const relativeRoot = app?.relativeRoot ?? ".";
  if (!(await exists(appRoot))) return null;
  return { fullName, dir, appRoot, relativeRoot };
}

async function findExisting(fullName: string): Promise<SourceTree | null> {
  const root = process.cwd();
  const slug = slugOf(fullName);
  const cached = path.join(root, ".seethrough", "sources", slug);
  if (await exists(cached)) {
    const tree = await treeFromDir(fullName, cached);
    if (tree) return tree;
  }

  const runs = path.join(root, ".seethrough", "runs");
  if (!(await exists(runs))) return null;
  const names = (await readdir(runs)).filter(
    (name) => name === slug || name.startsWith(`${slug}-`),
  );
  names.sort();
  for (const name of names.reverse()) {
    const tree = await treeFromDir(fullName, path.join(runs, name));
    if (tree) return tree;
  }
  return null;
}

async function downloadSource(input: {
  fullName: string;
  token?: string;
  ref: string;
}): Promise<SourceTree> {
  const [owner, repo] = input.fullName.split("/");
  if (!owner || !repo) throw new Error("Expected owner/repo.");
  const parent = path.join(process.cwd(), ".seethrough", "sources");
  await mkdir(parent, { recursive: true });
  const work = await mkdtemp(path.join(parent, `${slugOf(input.fullName)}-`));
  const tarball = path.join(work, "repo.tgz");
  await downloadTarball({
    token: input.token,
    owner,
    repo,
    ref: input.ref,
    destFile: tarball,
  });
  await extractTar(tarball, work);
  const tree = await treeFromDir(input.fullName, work);
  if (!tree) throw new Error("Could not find frontend files in that repository.");
  return tree;
}

export async function ensureSourceTree(input: {
  fullName: string;
  token?: string;
  ref?: string;
}): Promise<SourceTree> {
  const fullName = input.fullName.trim();
  const cached = store().get(keyOf(fullName));
  if (cached && !(cached instanceof Promise)) return cached;
  if (cached instanceof Promise) return cached;

  const pending = (async () => {
    const existing = await findExisting(fullName);
    if (existing) return existing;
    const ref = input.ref?.trim() || "HEAD";
    return downloadSource({ fullName, token: input.token, ref });
  })();

  store().set(keyOf(fullName), pending);
  try {
    const tree = await pending;
    store().set(keyOf(fullName), tree);
    return tree;
  } catch (error) {
    store().delete(keyOf(fullName));
    throw error;
  }
}
