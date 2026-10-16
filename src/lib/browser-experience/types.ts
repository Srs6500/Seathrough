import type { LessonSource } from "@/types/lesson";

export type BrowserProvider = "browserbase" | "browserless" | "local";

export type AnnotationKind =
  | "highlight"
  | "circle"
  | "clear"
  | "click"
  | "youtube_play"
  | "youtube_pause"
  | "youtube_seek";

export type BrowserAnnotation = {
  kind: AnnotationKind;
  /** Plain text to find on the page (preferred). */
  text?: string;
  /** CSS selector fallback when text match fails. */
  selector?: string;
  /** Optional note shown near the annotation. */
  label?: string;
  /** For youtube_seek — timestamp in seconds. */
  seconds?: number;
};

/** Sequential lesson roles: Ground → Truth → Act. */
export type BrowserLessonRole = "ground" | "truth" | "act";

export type BrowserLessonIntent = "concept" | "debug" | "default";

export type BrowserTabKind =
  | "blank"
  | "search"
  | "ground"
  | "truth"
  | "source"
  /** Dedicated labeled diagram / illustration image tab. */
  | "diagram";

/** One browser tab shown in the Muse-style tab strip. */
export type BrowserTabPublic = {
  id: string;
  title: string;
  url: string;
  faviconUrl: string | null;
  kind: BrowserTabKind;
  /** Matrix role this tab is teaching from, when pinned. */
  role: "ground" | "truth" | null;
  sourceId?: string | null;
};

export type BrowserRoleSource = {
  role: "ground" | "truth";
  url: string;
  title: string;
  source: LessonSource | null;
  isYouTube?: boolean;
  /** Live Playwright tab id when multi-tab is active. */
  tabId?: string;
};

export type BrowserActQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  /** 0-based index into choices. */
  answerIndex: number;
};

export type BrowserLessonMatrix = {
  intent: BrowserLessonIntent;
  /** Roles present for this lesson, in order. */
  roles: BrowserLessonRole[];
  ground: BrowserRoleSource | null;
  truth: BrowserRoleSource | null;
  act: { questions: BrowserActQuestion[] };
  activeRole: BrowserLessonRole;
};

export type BrowserTeachBeat = {
  id: string;
  /** Spoken + shown narration (short). */
  speech: string;
  annotation: BrowserAnnotation;
  /** Pause after speech before next beat (ms). */
  holdMs?: number;
  /** Which matrix role this beat belongs to. */
  role?: "ground" | "truth";
  /** Optional page URL for glass / multi-source labeling. */
  pageUrl?: string;
  /** Tab to activate when this beat plays (multi-tab). */
  tabId?: string;
  /** Optional glass diagram control (next phase). */
  diagramAction?: "none" | "reset" | "keep";
};

export type BrowserChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BrowserSessionPublic = {
  id: string;
  provider: BrowserProvider;
  liveViewUrl: string | null;
  /** True when the UI should poll JPEG frames (local Playwright). */
  frameStream: boolean;
  currentUrl: string;
  addressBar: string;
  status: BrowserSessionStatus;
  question: string;
  selectedSource: LessonSource | null;
  sources: LessonSource[];
  title: string | null;
  beats: BrowserTeachBeat[];
  history: BrowserChatMessage[];
  /** True when the active lesson is a YouTube walkthrough. */
  isYouTube?: boolean;
  /** Ground → Truth → Act workspace, when planned. */
  matrix?: BrowserLessonMatrix | null;
  /** Open browser tabs (Muse-style multi-tab). */
  tabs: BrowserTabPublic[];
  /** Currently visible / teach-active tab. */
  activeTabId: string | null;
  /** Human has the live browser; agent must not drive. */
  userControl?: boolean;
  /** Short reason when a CAPTCHA / bot wall was detected. */
  challengeReason?: string | null;
};

export type BrowserSessionStatus =
  | "idle"
  | "starting"
  | "searching"
  | "opening_search"
  | "opening_source"
  | "reading"
  | "teaching"
  | "awaiting_user"
  | "ready"
  | "error"
  | "closed";

export type BrowserAskResult = {
  session: BrowserSessionPublic;
  beats: BrowserTeachBeat[];
  summary: string;
};

export type BrowserFollowUpResult = {
  session: BrowserSessionPublic;
  beats: BrowserTeachBeat[];
  summary: string;
};

export type BrowserStreamEvent =
  | { type: "status"; status: BrowserSessionStatus; message?: string }
  | { type: "session"; session: BrowserSessionPublic }
  | { type: "source"; source: LessonSource }
  | { type: "matrix"; matrix: BrowserLessonMatrix }
  | {
      type: "tabs";
      tabs: BrowserTabPublic[];
      activeTabId: string | null;
    }
  | {
      type: "challenge";
      reason: string;
      session: BrowserSessionPublic;
    }
  | { type: "beats"; beats: BrowserTeachBeat[]; summary: string }
  | { type: "error"; error: string }
  | { type: "done" };
