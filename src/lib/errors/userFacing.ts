/**
 * Map provider/infra errors to calm copy for learners.
 * Never surface raw Groq/OpenAI/Deepgram quota text in the UI.
 */
export const BUSY_USER_MESSAGE =
  "Our app is facing a lot of users right now — we're working on fixing the issues. Please try again in a few minutes.";

const GENERIC_USER_MESSAGE =
  "Something went wrong while starting the lesson. Please try again in a moment.";

export function toUserFacingError(
  error: unknown,
  fallback = GENERIC_USER_MESSAGE,
): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";

  if (!raw.trim()) return fallback;

  if (isCapacityOrRateLimitError(raw)) {
    return BUSY_USER_MESSAGE;
  }

  // Known safe / intentional product messages — keep as-is
  if (
    /^(Prompt is required|Description is required|Description is too long|Conversation not found|Session not found|Lesson stream returned an empty body|Add OPENAI_API_KEY|Add GROQ_API_KEY|Add TAVILY_API_KEY|Add BROWSERBASE_API_KEY|Add BROWSERLESS_API_KEY|Local Chromium is not available|Enter a topic|Crash details are required|Sign in required|Prompt is too long|The scene planner|The scene agent|Couldn't get a stable 3D scene|Voice is not configured|Nothing to speak|Couldn't hear that|Start a lesson first|Start a browser lesson first|Not enough lesson context|This tutor can only help with learning topics|Invalid tutor input|An answer is required|No active concept|Could not draw that|Could not explain that|Could not explain that page|Could not start the browser lesson|Could not answer that follow-up|Could not highlight that on the page|Could not switch to that lesson step|This lesson has no Ground step|This lesson has no Truth step|No lesson workspace is ready yet|Could not reopen the Ground video|You’re in control of the browser|That check still looks open|Timed out waiting for the browser check|Could not take control of the browser|Could not resume the lesson|Could not update browser control|Take control needs a cloud browser|Could not open an interactive live view|No credible sources found|That page did not have enough readable text|I couldn’t find a page|Local browser failed to start|The board is still loading|Nothing to save yet|This browser cannot record|Could not save that video|Could not save that recording|Could not start recording|Recording was cancelled|Screen recording is not available|The recording was empty|A video file is required|That video is too large|A title is required|Video not found|The film plan|The film could not be written|The film could not be drawn|The film writer|The film played|Ask a question first|That request isn’t allowed|I can’t search for|Could not search for a reference image|Image reference search is turned off|No trusted reference image found|Search was cancelled)/i.test(
      raw,
    )
  ) {
    return raw;
  }

  // Provider structured-output / generation failures
  if (isProviderGenerationError(raw)) {
    return fallback;
  }

  // Hide provider / org / model / billing leakage
  if (
    /\b(groq|openai|deepgram|anthropic|org_[a-z0-9]+|llama-|gpt-|qwen|console\.|api key|billing|tokens? per day|TPD|TPM|RPM|OTPM|failed_generation)\b/i.test(
      raw,
    )
  ) {
    return fallback;
  }

  // Hide HTTP / stack-ish dumps
  if (/\b(400|401|403|404|429|500|502|503|ECONN|ETIMEDOUT|fetch failed)\b/i.test(raw)) {
    if (/\b429\b|rate limit|quota|capacity/i.test(raw)) {
      return BUSY_USER_MESSAGE;
    }
    return fallback;
  }

  // If it looks like an internal dump, sanitize
  if (raw.length > 180 || /at\s+\S+\s+\(/.test(raw) || /stack/i.test(raw)) {
    return fallback;
  }

  return raw;
}

export function isCapacityOrRateLimitError(message: string): boolean {
  return /\b(429|rate limit|rate_limit|tokens? per day|TPD|TPM|RPM|OTPM|quota|too many requests|capacity|overloaded|resource_exhausted|request too large)\b/i.test(
    message,
  );
}

export function isProviderGenerationError(message: string): boolean {
  return /\b(failed to validate json|failed_generation|invalid json|json_validate|lesson plan failed validation|empty lesson plan|quiz question failed validation|empty quiz|adjust your prompt)\b/i.test(
    message,
  );
}
