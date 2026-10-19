import type { FrontendArchScanResult } from "@/lib/frontend-arch/types";

const archScanCache = new Map<string, FrontendArchScanResult>();

function cacheKey(fullName: string, ref?: string): string {
  return `${fullName.trim().toLowerCase()}@${(ref || "default").trim()}`;
}

export function getCachedFrontendArchScan(
  fullName: string,
  ref?: string,
): FrontendArchScanResult | null {
  return archScanCache.get(cacheKey(fullName, ref)) ?? null;
}

export function clearFrontendArchScanCache(fullName?: string, ref?: string) {
  if (!fullName) {
    archScanCache.clear();
    return;
  }
  archScanCache.delete(cacheKey(fullName, ref));
}

export async function runFrontendArchScan(
  accessToken: string,
  input: { fullName: string; ref?: string },
  options?: { force?: boolean },
): Promise<FrontendArchScanResult> {
  const key = cacheKey(input.fullName, input.ref);
  if (!options?.force) {
    const hit = archScanCache.get(key);
    if (hit) return hit;
  }

  const res = await fetch("/api/frontend-arch/scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    scan?: FrontendArchScanResult;
    error?: string;
  };
  if (!res.ok || !json.scan) {
    throw new Error(json.error || "Frontend architecture scan failed.");
  }
  archScanCache.set(key, json.scan);
  return json.scan;
}
