/**
 * Deepgram word confidence below this is treated as background (TV, other
 * people, far-off voices), not the student. Shared by the direct and proxied
 * live listeners.
 */
export const MIN_STT_CONFIDENCE = 0.55;
