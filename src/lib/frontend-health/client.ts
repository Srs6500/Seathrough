import type { FrontendScanResult } from "@/lib/frontend-health/types";

export async function runFrontendHealthScan(
  accessToken: string,
  body?: { targetUrl?: string; useFixture?: boolean },
): Promise<FrontendScanResult> {
  const res = await fetch("/api/frontend-health/scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body ?? { useFixture: true }),
  });
  const json = (await res.json()) as {
    scan?: FrontendScanResult;
    error?: string;
  };
  if (!res.ok || !json.scan) {
    throw new Error(json.error || "Frontend health scan failed.");
  }
  return json.scan;
}
