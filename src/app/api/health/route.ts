import { withSeethroughDebug } from "@seethrough/debug/next";
import { envPresence } from "@/lib/env";

export const runtime = "nodejs";

/** Safe health check — reports which env keys are present, never values. */
export const GET = withSeethroughDebug(async () => {
  const presence = envPresence();
  const ready =
    (presence.LLM_PROVIDER === "groq"
      ? presence.GROQ_API_KEY
      : presence.OPENAI_API_KEY) &&
    presence.NEXT_PUBLIC_SUPABASE_URL &&
    presence.SUPABASE_SERVICE_ROLE_KEY;

  return Response.json({
    ok: Boolean(ready),
    provider: presence.LLM_PROVIDER,
    services: {
      llm:
        presence.LLM_PROVIDER === "groq"
          ? presence.GROQ_API_KEY
          : presence.OPENAI_API_KEY,
      deepgram: presence.DEEPGRAM_API_KEY,
      supabase: Boolean(
        presence.NEXT_PUBLIC_SUPABASE_URL &&
          presence.SUPABASE_SERVICE_ROLE_KEY,
      ),
    },
  });
});
