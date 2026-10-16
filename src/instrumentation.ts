/**
 * Boots @seethrough/debug in local/dev Node (errors + request collector).
 * See packages/debug/README.md
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const mod = await import("@seethrough/debug");
    mod.init({
      project: process.env.SEETHROUGH_DEBUG_PROJECT || "seethrough",
      collector: true,
    });
  } catch (error) {
    console.warn(
      "[@seethrough/debug] failed to start:",
      error instanceof Error ? error.message : error,
    );
  }
}
