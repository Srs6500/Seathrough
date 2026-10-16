/** Client types for AI Tutor v2. Matches the Python `/api/v2` contract. */

export type LearnerLevel = "beginner" | "intermediate" | "advanced";

export type LessonMode =
  | "concept"
  | "worked_example"
  | "process"
  | "comparison"
  | "timeline"
  | "code_walkthrough"
  | "mixed";

export type Point = { x: number; y: number };

export type SceneNode =
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      text: string;
      role?: "title" | "label" | "body";
    }
  | {
      id: string;
      type: "box";
      x: number;
      y: number;
      width: number;
      height: number;
      label?: string | null;
    }
  | {
      id: string;
      type: "arrow";
      start: Point;
      end: Point;
      label?: string | null;
    };

export type BoardAction =
  | {
      type: "create";
      node: SceneNode;
      animation?: "draw" | "fade" | "pop" | "none";
    }
  | {
      type: "update";
      target_id: string;
      patch: Partial<{
        x: number;
        y: number;
        text: string;
        label: string | null;
        width: number;
        height: number;
        role: "title" | "label" | "body";
      }>;
      animation?: "morph" | "fade" | "none";
    }
  | {
      type: "remove";
      target_id: string;
      animation?: "fade" | "none";
    }
  | {
      type: "point";
      target_id: string;
      emphasis_ms?: number | null;
    };

export type LessonCreated = {
  lesson_id: string;
  version_id: string;
  status: string;
  events_url: string;
};

export type InteractionCreated = {
  interaction_id: string;
  lesson_id: string;
  version_id: string;
  status: string;
  events_url: string;
};

export type TranscriptBeat = {
  beat_id: string | null;
  objective: string;
  narration: string;
};

export type LessonDetail = {
  lesson_id: string;
  version_id: string | null;
  status: string;
  title: string | null;
  question: string;
  mode: string | null;
  schema_version: string;
  language: string;
  learner_level: string;
  transcript: TranscriptBeat[];
  created_at: string;
  updated_at: string;
};

export type StreamEventEnvelope = {
  lesson_id: string;
  version_id: string;
  seq: number;
  beat_id: string | null;
  payload: Record<string, unknown>;
};

export type InteractionKind =
  | "question"
  | "pause"
  | "resume"
  | "repeat"
  | "simplify"
  | "give_example"
  | "change_mode"
  | "start_over";
