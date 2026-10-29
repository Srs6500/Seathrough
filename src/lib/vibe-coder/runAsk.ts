import { spawn } from "node:child_process";
import path from "node:path";
import type { VibeAskResult, VibeGuide } from "@/lib/vibe-coder/types";

const ASK_TIMEOUT_MS = 25_000;

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

export function runVibeAsk(
  question: string,
  guide: VibeGuide,
): Promise<VibeAskResult> {
  const root = /* turbopackIgnore: true */ process.cwd();
  const script = path.join(
    /* turbopackIgnore: true */ root,
    "backend",
    "vibe_model.py",
  );
  const bin = /* turbopackIgnore: true */ pythonBin();
  const child = spawn(/* turbopackIgnore: true */ bin, ["-u", script], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
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
      reject(new Error("The question took too long."));
    }, ASK_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.message.includes("ENOENT")
            ? "Python is not available on this machine."
            : "Could not start the guide.",
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString("utf8").trim();
      if (!text) {
        reject(new Error("The guide returned no answer."));
        return;
      }
      try {
        const parsed = extractJsonObject(text) as VibeAskResult & {
          error?: string;
        };
        if (code !== 0 && !parsed.answer) {
          reject(new Error(parsed.error || "The guide could not answer."));
          return;
        }
        resolve({
          answer: String(parsed.answer || "SeeThrough could not find that in the scan."),
          feature_id: parsed.feature_id ?? null,
          files: Array.isArray(parsed.files) ? parsed.files.map(String) : [],
        });
      } catch {
        reject(new Error("The guide returned something we could not read."));
      }
    });

    child.stdin.write(JSON.stringify({ question, guide }));
    child.stdin.end();
  });
}
