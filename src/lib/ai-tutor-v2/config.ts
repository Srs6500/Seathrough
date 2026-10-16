/** Server-only base URL for the AI Tutor v2 FastAPI service. */

export function getAiTutorV2BaseUrl(): string {
  const raw =
    process.env.AI_TUTOR_V2_URL?.trim() || "http://127.0.0.1:8000";
  return raw.replace(/\/$/, "");
}
