import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestTrace } from "./types.js";

export type RequestContext = {
  request: RequestTrace;
};

export const requestStorage = new AsyncLocalStorage<RequestContext>();

export function currentRequest(): RequestTrace | undefined {
  return requestStorage.getStore()?.request;
}
