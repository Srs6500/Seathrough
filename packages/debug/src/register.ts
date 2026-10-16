/**
 * Side-effect entry for Next.js `instrumentation.ts`:
 *
 * ```ts
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === "nodejs") {
 *     await import("@seethrough/debug/register");
 *   }
 * }
 * ```
 */
import { init } from "./runtime.js";

init({
  project: process.env.SEETHROUGH_DEBUG_PROJECT,
  collector: true,
});
