import type { SeethroughDebugOptions } from "./types.js";

export function isDebugEnabled(options?: SeethroughDebugOptions): boolean {
  if (typeof options?.enabled === "boolean") return options.enabled;
  if (process.env.SEETHROUGH_DEBUG === "0" || process.env.SEETHROUGH_DEBUG === "false") {
    return false;
  }
  if (process.env.SEETHROUGH_DEBUG === "1" || process.env.SEETHROUGH_DEBUG === "true") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

export function resolveDir(options?: SeethroughDebugOptions): string {
  return (
    options?.dir ||
    process.env.SEETHROUGH_DEBUG_DIR ||
    ".seethrough/debug"
  );
}
