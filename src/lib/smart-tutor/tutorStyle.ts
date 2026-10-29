export const TUTOR_STYLES = ["text", "diagram", "physics"] as const;

export type TutorStyle = (typeof TUTOR_STYLES)[number];

export const DEFAULT_TUTOR_STYLE: TutorStyle = "text";

const STORAGE_KEY = "seethrough-smart-tutor-style";

export function isTutorStyle(value: string | null | undefined): value is TutorStyle {
  return value === "text" || value === "diagram" || value === "physics";
}

export function parseTutorStyle(
  value: string | null | undefined,
): TutorStyle | null {
  return isTutorStyle(value) ? value : null;
}

export function smartTutorHref(style: TutorStyle): string {
  return `/smart-tutor?mode=${style}`;
}

export function readStoredTutorStyle(): TutorStyle | null {
  if (typeof window === "undefined") return null;
  try {
    return parseTutorStyle(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeTutorStyle(style: TutorStyle) {
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    /* ignore */
  }
}
