import { spawn } from "node:child_process";
import path from "node:path";
import {
  sandboxEnvOverrides,
  sanitizeSandbox,
  type RepoScanSandboxInput,
} from "@/lib/repo-scan/sandbox";
import type { TreeSitterParseResult } from "@/lib/repo-scan/types";

const PYTHON_TIMEOUT_MS = 120_000;
const INSTALL_HINT =
  "tree-sitter is not installed. Run: python3 -m pip install -r backend/requirements-tree-sitter.txt";

function pythonBin() {
  const configured =
    process.env.PYTHON_PATH?.trim() || process.env.PYTHON?.trim();
  if (configured) return configured;
  return process.platform === "win32" ? "python" : "python3";
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("not-json");
  }
}

function safeStderr(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 220);
}

export type TreeSitterInput = {
  fullName?: string;
  ref?: string;
  truncated?: boolean;
  labelClusters?: boolean;
  files: Array<{ path: string; content: string }>;
  sandbox?: RepoScanSandboxInput;
};

export function runTreeSitterParse(
  payload: TreeSitterInput,
): Promise<TreeSitterParseResult> {
  const root = /* turbopackIgnore: true */ process.cwd();
  const script = path.join(
    /* turbopackIgnore: true */ root,
    "backend",
    "tree-sitter.py",
  );
  const bin = /* turbopackIgnore: true */ pythonBin();
  const sandbox = sanitizeSandbox(payload.sandbox);
  const child = spawn(/* turbopackIgnore: true */ bin, ["-u", script], {
    cwd: root,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      ...sandboxEnvOverrides(sandbox),
    },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Tree-sitter took too long. Try a smaller repository."));
    }, PYTHON_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.message.includes("ENOENT")
            ? "Python is not available on this machine."
            : "Could not start tree-sitter.",
        ),
      );
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString("utf8").trim();
      const errText = safeStderr(Buffer.concat(stderr).toString("utf8"));
      const crashed =
        signal === "SIGSEGV" ||
        signal === "SIGBUS" ||
        signal === "SIGABRT" ||
        code === 138 ||
        code === 139;
      if (crashed) {
        reject(
          new Error(
            "Tree-sitter crashed while parsing this repository. Try again, or pick a smaller repo.",
          ),
        );
        return;
      }
      if (!text) {
        reject(
          new Error(
            /no module named ['"]tree_sitter/i.test(errText)
              ? INSTALL_HINT
              : errText && !/key|token|secret|bearer/i.test(errText)
                ? `Tree-sitter returned no response. ${errText}`
                : "Tree-sitter returned no response.",
          ),
        );
        return;
      }
      try {
        const parsed = extractJsonObject(text) as TreeSitterParseResult;
        if (parsed.ok === false) {
          reject(new Error(parsed.error || "Tree-sitter could not parse that."));
          return;
        }
        if (code !== 0 && parsed.ok !== true) {
          reject(new Error(parsed.error || "Tree-sitter could not parse that."));
          return;
        }
        resolve(parsed);
      } catch {
        reject(
          new Error(
            /no module named ['"]tree_sitter/i.test(errText)
              ? INSTALL_HINT
              : errText && !/key|token|secret|bearer/i.test(errText)
                ? `Tree-sitter returned something we could not read. ${errText}`
                : "Tree-sitter returned something we could not read.",
          ),
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
