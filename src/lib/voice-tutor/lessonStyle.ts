/** How the voice tutor grounds and presents a lesson. */
export type VoiceTutorStyle = "default" | "news";

export function parseVoiceTutorStyle(value: unknown): VoiceTutorStyle {
  return value === "news" ? "news" : "default";
}

export function isNewsStyle(style: VoiceTutorStyle | undefined): boolean {
  return style === "news";
}
