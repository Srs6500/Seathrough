export type {
  CapturedError,
  DebugEvent,
  DebugSpan,
  RequestTrace,
  SeethroughDebugOptions,
} from "./types.js";

export { isDebugEnabled } from "./env.js";
export { redactBodyPreview, redactHeaders } from "./redact.js";
export { currentRequest } from "./context.js";
export {
  init,
  getRuntime,
  captureException,
  captureLog,
  beginRequest,
  endRequest,
  addSpan,
  endSpan,
  listEvents,
  clearEvents,
} from "./runtime.js";

export { withSeethroughDebug, wrapRoute } from "./next.js";
