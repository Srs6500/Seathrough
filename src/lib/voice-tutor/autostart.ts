/**
 * One-shot hand-off: the landing page's orb asks Smart Tutor to start talking
 * as soon as it opens. Stored in sessionStorage so it survives the client-side
 * navigation (Smart Tutor rewrites its URL, so a query param would be lost)
 * and is consumed exactly once.
 */
const KEY = "seethrough.voiceTutor.autostart";
/** Ignore a stale request (e.g. the user backed out before the tutor loaded). */
const MAX_AGE_MS = 15_000;

export function requestTutorAutostart(): void {
  try {
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked — the tutor just opens without auto-starting */
  }
}

export function consumeTutorAutostart(): boolean {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return raw !== null && Date.now() - Number(raw) < MAX_AGE_MS;
  } catch {
    return false;
  }
}
