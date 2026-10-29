import type { VibeSandbox } from "@/lib/vibe-coder/types";

export const EMPTY_SANDBOX: VibeSandbox = {
  baseUrl: "",
  apiUrl: "",
  user: "",
  password: "",
};

export function sanitizeHttpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.origin}${path}`;
  } catch {
    return "";
  }
}

export function sanitizeSandbox(
  input: Partial<VibeSandbox> | null | undefined,
): VibeSandbox {
  return {
    baseUrl: sanitizeHttpUrl(String(input?.baseUrl || "")),
    apiUrl: sanitizeHttpUrl(String(input?.apiUrl || "")),
    user: String(input?.user || "").trim().slice(0, 200),
    password: String(input?.password || "").slice(0, 200),
  };
}

export function sandboxEnvOverrides(sandbox: VibeSandbox): Record<string, string> {
  const env: Record<string, string> = {};
  if (sandbox.baseUrl) env.REPO_SCAN_TEST_BASE_URL = sandbox.baseUrl;
  if (sandbox.apiUrl) env.REPO_SCAN_TEST_API_URL = sandbox.apiUrl;
  if (sandbox.user) env.REPO_SCAN_TEST_USER = sandbox.user;
  if (sandbox.password) env.REPO_SCAN_TEST_PASSWORD = sandbox.password;
  if (sandbox.baseUrl) env.REPO_SCAN_SANDBOX = "1";
  return env;
}
