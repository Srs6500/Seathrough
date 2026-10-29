import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  detectPackageManager,
  devCommand,
  findDevApp,
  looksReady,
} from "@/lib/bug-analyzer/detectDevApp";
import { injectInspector } from "@/lib/bug-analyzer/inspectorInject";

export type LocalRunStatus =
  | "idle"
  | "cloning"
  | "installing"
  | "starting"
  | "ready"
  | "error"
  | "stopped";

export type LocalRunState = {
  fullName: string;
  status: LocalRunStatus;
  port: number | null;
  previewUrl: string | null;
  error: string | null;
  dir: string | null;
  appRoot: string | null;
  kind: string | null;
  logs: string[];
  updatedAt: string;
};

type InternalRun = LocalRunState & {
  /** stdin may be ignored when stdio[0] is "ignore". */
  child: ChildProcess | null;
};

const globalKey = "__seethrough_local_runs__";

function store(): Map<string, InternalRun> {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, InternalRun>;
  };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

function keyOf(fullName: string): string {
  return fullName.trim().toLowerCase();
}

function publicState(run: InternalRun): LocalRunState {
  return {
    fullName: run.fullName,
    status: run.status,
    port: run.port,
    previewUrl: run.previewUrl,
    error: run.error,
    dir: run.dir,
    appRoot: run.appRoot ?? null,
    kind: run.kind ?? null,
    logs: run.logs.slice(-60),
    updatedAt: run.updatedAt,
  };
}

function touch(run: InternalRun, patch: Partial<InternalRun>) {
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function pushLog(run: InternalRun, line: string) {
  for (const part of stripAnsi(line).replace(/\r/g, "").split("\n")) {
    const trimmed = part.trimEnd();
    if (!trimmed) continue;
    run.logs.push(trimmed);
  }
  if (run.logs.length > 200) run.logs.splice(0, run.logs.length - 200);
  run.updatedAt = new Date().toISOString();
}

export function isLocalRunEnabled(): boolean {
  if (process.env.SEETHROUGH_LOCAL_RUN === "0") return false;
  if (process.env.SEETHROUGH_LOCAL_RUN === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export function getLocalRun(fullName: string): LocalRunState | null {
  const run = store().get(keyOf(fullName));
  return run ? publicState(run) : null;
}

async function freePort(start = 3100): Promise<number> {
  for (let port = start; port < start + 80; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error("No free local port available.");
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
    "User-Agent": "Seethrough-local-run",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;

  const refPath = encodeURIComponent(input.ref);
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/tarball/${refPath}`;
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download repo tarball (${response.status}). ${
        response.status === 404
          ? "Repo not found or not accessible."
          : "Check GitHub access."
      }`,
    );
  }

  await pipeline(
    Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream,
    ),
    createWriteStream(input.destFile),
  );
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  onData: (chunk: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (buf: Buffer) => onData(buf.toString("utf8")));
    child.stderr.on("data", (buf: Buffer) => onData(buf.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

export async function stopLocalRun(
  fullName: string,
): Promise<LocalRunState | null> {
  const run = store().get(keyOf(fullName));
  if (!run) return null;
  if (run.child && !run.child.killed) {
    run.child.kill("SIGTERM");
    setTimeout(() => {
      try {
        run.child?.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2000);
  }
  touch(run, {
    child: null,
    status: "stopped",
    previewUrl: null,
    port: null,
  });
  pushLog(run, "Stopped local run.");
  return publicState(run);
}

/** Download, install, and start the repo's frontend on localhost. */
export async function startLocalRun(input: {
  fullName: string;
  token?: string;
  ref: string;
  injectInspector?: boolean;
}): Promise<LocalRunState> {
  if (!isLocalRunEnabled()) {
    throw new Error("Local run is disabled in this environment.");
  }

  const fullName = input.fullName.trim();
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error("Expected owner/repo.");

  const existing = store().get(keyOf(fullName));
  if (
    existing &&
    (existing.status === "starting" ||
      existing.status === "installing" ||
      existing.status === "cloning")
  ) {
    return publicState(existing);
  }
  if (existing?.child || existing?.status === "ready") {
    await stopLocalRun(fullName);
  }

  const run: InternalRun = {
    fullName,
    status: "cloning",
    port: null,
    previewUrl: null,
    error: null,
    dir: null,
    appRoot: null,
    kind: null,
    logs: [],
    updatedAt: new Date().toISOString(),
    child: null,
  };
  store().set(keyOf(fullName), run);
  pushLog(run, `Starting local run for ${fullName}…`);

  void (async () => {
    try {
      const root = path.join(process.cwd(), ".seethrough", "runs");
      await mkdir(root, { recursive: true });
      const work = await mkdtemp(path.join(root, `${owner}-${repo}-`));
      touch(run, { dir: work, status: "cloning" });

      const tarball = path.join(work, "repo.tgz");
      pushLog(run, `Downloading ${fullName}@${input.ref}…`);
      await downloadTarball({
        token: input.token,
        owner,
        repo,
        ref: input.ref,
        destFile: tarball,
      });

      pushLog(run, "Extracting archive…");
      await runCommand(
        "tar",
        ["-xzf", tarball, "-C", work, "--strip-components=1"],
        work,
        (chunk) => pushLog(run, chunk),
      );

      const app = await findDevApp(work);
      if (!app) {
        throw new Error(
          "No Node frontend was found. Need a package.json with Next, Vite, or a dev script.",
        );
      }
      touch(run, { appRoot: app.relativeRoot, kind: app.kind });
      pushLog(
        run,
        `App at ${app.relativeRoot === "." ? "repo root" : app.relativeRoot} (${app.kind}).`,
      );

      if (input.injectInspector !== false) {
        try {
          const injected = await injectInspector(app.appRoot);
          pushLog(run, injected);
        } catch (error) {
          pushLog(
            run,
            `Inspector inject skipped: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
      }

      const pm = await detectPackageManager(app.installRoot);
      touch(run, { status: "installing" });
      pushLog(run, `Installing dependencies with ${pm.name} in ${path.relative(work, app.installRoot) || "."}…`);
      await runCommand(
        pm.install.command,
        pm.install.args,
        app.installRoot,
        (chunk) => pushLog(run, chunk),
      );

      const port = await freePort(3100);
      const dev = devCommand(app.kind, pm, port, app.script);
      touch(run, { status: "starting", port });
      pushLog(run, `Starting ${app.kind} on http://127.0.0.1:${port}…`);

      const child = spawn(dev.command, dev.args, {
        cwd: app.appRoot,
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          HOSTNAME: "127.0.0.1",
          FORCE_COLOR: "0",
          BROWSER: "none",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      touch(run, { child });

      let ready = false;
      const markReady = () => {
        if (ready) return;
        ready = true;
        touch(run, {
          status: "ready",
          previewUrl: `http://127.0.0.1:${port}`,
          error: null,
        });
        pushLog(run, `Ready at http://127.0.0.1:${port}`);
      };

      child.stdout.on("data", (buf: Buffer) => {
        const text = buf.toString("utf8");
        pushLog(run, text);
        if (looksReady(text)) markReady();
      });
      child.stderr.on("data", (buf: Buffer) => {
        const text = buf.toString("utf8");
        pushLog(run, text);
        if (looksReady(text)) markReady();
      });
      child.on("error", (error) => {
        touch(run, {
          status: "error",
          error: error.message,
          child: null,
        });
        pushLog(run, error.message);
      });
      child.on("close", (code) => {
        if (run.status === "stopped") return;
        touch(run, {
          child: null,
          status: code === 0 ? "stopped" : "error",
          error:
            code === 0
              ? null
              : `Dev server exited with code ${code ?? "unknown"}.`,
          previewUrl: null,
        });
        pushLog(run, run.error || "Dev server stopped.");
      });

      // Fallback ready check: poll TCP
      for (let i = 0; i < 60 && !ready && run.status === "starting"; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const up = await new Promise<boolean>((resolve) => {
          const socket = net.connect({ port, host: "127.0.0.1" }, () => {
            socket.end();
            resolve(true);
          });
          socket.on("error", () => resolve(false));
        });
        if (up) markReady();
      }

      if (!ready && run.status === "starting") {
        touch(run, {
          status: "error",
          error: "Dev server did not become ready in time.",
        });
        pushLog(run, run.error!);
        child.kill("SIGTERM");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Local run failed.";
      touch(run, { status: "error", error: message, child: null });
      pushLog(run, message);
    }
  })();

  return publicState(run);
}
