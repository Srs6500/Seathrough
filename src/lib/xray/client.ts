import type { XRayAskPayload, XRayAskResult } from "@/lib/xray/types";

export async function askXRayFeature(
  accessToken: string,
  payload: XRayAskPayload,
): Promise<XRayAskResult> {
  const response = await fetch("/api/bug-analyzer/xray/ask", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (XRayAskResult & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error || "Could not explain that feature.");
  }
  if (!body?.answer) {
    throw new Error("Could not explain that feature.");
  }
  return {
    answer: body.answer,
    citations: body.citations ?? [],
    source: body.source ?? "heuristic",
  };
}
