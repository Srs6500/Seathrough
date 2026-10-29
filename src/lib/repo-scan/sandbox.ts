export type RepoScanSandboxInput = {
  baseUrl: string;
  apiUrl: string;
  user: string;
  password: string;
};

const STORAGE_KEY = "seethrough.repo-scan.sandbox.v1";

export const EMPTY_SANDBOX: RepoScanSandboxInput = {
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
  input: Partial<RepoScanSandboxInput> | null | undefined,
): RepoScanSandboxInput {
  return {
    baseUrl: sanitizeHttpUrl(String(input?.baseUrl || "")),
    apiUrl: sanitizeHttpUrl(String(input?.apiUrl || "")),
    user: String(input?.user || "").trim().slice(0, 200),
    password: String(input?.password || "").slice(0, 200),
  };
}

export function readStoredSandbox(): RepoScanSandboxInput {
  if (typeof window === "undefined") return EMPTY_SANDBOX;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SANDBOX;
    return sanitizeSandbox(JSON.parse(raw) as Partial<RepoScanSandboxInput>);
  } catch {
    return EMPTY_SANDBOX;
  }
}

export function writeStoredSandbox(input: RepoScanSandboxInput) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSandbox(input)));
  } catch {
    // ignore quota
  }
}

export function sandboxEnvOverrides(
  input: RepoScanSandboxInput,
): Record<string, string> {
  const next: Record<string, string> = {};
  if (input.baseUrl) {
    next.REPO_SCAN_TEST_BASE_URL = input.baseUrl;
    next.REPO_SCAN_SANDBOX = "1";
  }
  if (input.apiUrl) next.REPO_SCAN_TEST_API_URL = input.apiUrl;
  if (input.user) next.REPO_SCAN_TEST_USER = input.user;
  if (input.password) next.REPO_SCAN_TEST_PASSWORD = input.password;
  return next;
}
