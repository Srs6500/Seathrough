import { getAiTutorV2BaseUrl } from "@/lib/ai-tutor-v2/config";

export async function proxyToTutorV2(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${getAiTutorV2BaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "unavailable",
          message:
            "AI Tutor v2 is not reachable. Start the Python API on port 8000.",
        },
      },
      { status: 503 },
    );
  }
}

export async function readTutorError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      detail?: string;
    };
    if (body.error?.message) return body.error.message;
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // fall through
  }
  return `Request failed (${response.status}).`;
}
