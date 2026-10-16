import { requestStorage } from "./context.js";
import {
  beginRequest,
  captureException,
  endRequest,
  init,
  getRuntime,
} from "./runtime.js";
import type { SeethroughDebugOptions } from "./types.js";

type AnyHandler = (
  request: Request,
  context?: unknown,
) => Response | Promise<Response>;

/**
 * Wrap a Next.js App Router route handler to record request traces + errors.
 *
 * @example
 * export const POST = withSeethroughDebug(async (req) => {
 *   return Response.json({ ok: true });
 * });
 */
export function withSeethroughDebug(
  handler: AnyHandler,
  options?: SeethroughDebugOptions,
): AnyHandler {
  if (!getRuntime()) init(options ?? {});

  return async (request, context) => {
    const runtime = getRuntime();
    if (!runtime?.enabled) {
      return handler(request, context);
    }

    let bodyPreview: unknown;
    try {
      const clone = request.clone();
      const contentType = clone.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        bodyPreview = await clone.json();
      } else if (
        contentType.includes("text/") ||
        contentType.includes("application/x-www-form-urlencoded")
      ) {
        bodyPreview = await clone.text();
      }
    } catch {
      bodyPreview = undefined;
    }

    const trace = beginRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
      bodyPreview,
    });

    return requestStorage.run({ request: trace }, async () => {
      try {
        const response = await handler(request, context);
        endRequest(trace, response.status);
        return response;
      } catch (error) {
        captureException(error, { source: "route-handler" });
        endRequest(trace, 500, error);
        throw error;
      }
    });
  };
}

/** Alias used in docs. */
export const wrapRoute = withSeethroughDebug;
