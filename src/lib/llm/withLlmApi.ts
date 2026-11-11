import { getRequester } from "@/lib/billing/server";
import { runWithLlmRequestContext } from "@/lib/llm/context";

/**
 * Bind user/anon + feature onto AsyncLocalStorage for every LLM call
 * made while handling this HTTP request.
 */
export async function withLlmApi<T>(
  request: Request,
  feature: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const requester = await getRequester(request);
  return runWithLlmRequestContext(
    {
      feature,
      userId: requester.user?.id ?? null,
      anonId: requester.anonId,
      meta,
    },
    fn,
  );
}
