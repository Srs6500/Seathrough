/** Per-student tutor preferences, kept in this browser. */
export type TutorSettings = {
  /** What the tutor calls the student; empty = no name. */
  name: string;
  /** Ask check questions after explaining. Off = explain only. */
  askQuestions: boolean;
};

export const DEFAULT_TUTOR_SETTINGS: TutorSettings = { name: "", askQuestions: true };

const KEY = "seethrough.voiceTutor.settings.v1";

export function loadTutorSettings(): TutorSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_TUTOR_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TutorSettings>;
    return {
      name: typeof parsed.name === "string" ? parsed.name.slice(0, 40) : "",
      askQuestions: parsed.askQuestions !== false,
    };
  } catch {
    return DEFAULT_TUTOR_SETTINGS;
  }
}

export function saveTutorSettings(settings: TutorSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode / blocked storage: settings last for this visit only */
  }
}

/** Greeting that always uses the student's name when we have one. */
export function personalGreeting(name: string, fallback: string): string {
  const n = name.trim();
  if (!n) return fallback;
  const lines = [
    `Hey ${n}! What should we learn today? Name a topic and we'll narrow it.`,
    `Hi ${n}, good to have you. What are you curious about today?`,
    `Welcome back, ${n}. Throw me a topic, big or small, and we'll shape a lesson.`,
    `Hey ${n} — ready when you are. What do you want to learn?`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
