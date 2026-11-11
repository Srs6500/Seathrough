import { AsyncLocalStorage } from "async_hooks";

export type LlmRequestContext = {
  feature?: string;
  userId?: string | null;
  anonId?: string | null;
  meta?: Record<string, unknown>;
};

const storage = new AsyncLocalStorage<LlmRequestContext>();

export function getLlmRequestContext(): LlmRequestContext {
  return storage.getStore() ?? {};
}

export function runWithLlmRequestContext<T>(
  context: LlmRequestContext,
  fn: () => T,
): T {
  const parent = getLlmRequestContext();
  return storage.run(
    {
      feature: context.feature ?? parent.feature,
      userId: context.userId ?? parent.userId,
      anonId: context.anonId ?? parent.anonId,
      meta: { ...(parent.meta ?? {}), ...(context.meta ?? {}) },
    },
    fn,
  );
}
