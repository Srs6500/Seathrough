import { z } from "zod";
import type { TeachFormats } from "@/components/voice-tutor/TeachFormatPicker";
import type {
  HistorySession,
  VoiceLessonPlan,
} from "@/lib/voice-tutor/sessionTypes";
import type { SessionVisuals } from "@/lib/voice-tutor/visualStore";
import type { WhiteboardSession } from "@/lib/voice-tutor/whiteboard/schema";

/** JSON-safe stage snapshot — no Blob media/video (those stay on-device). */
export type SmartTutorCloudVisuals = {
  formats?: TeachFormats;
  plan: VoiceLessonPlan | null;
  board: SessionVisuals["board"];
  draw: SessionVisuals["draw"];
  drawings: SessionVisuals["drawings"];
  sections: SessionVisuals["sections"];
  stanzas: SessionVisuals["stanzas"];
  figures: SessionVisuals["figures"];
  whiteboard: WhiteboardSession | null;
};

export type SmartTutorCloudSession = HistorySession & {
  visuals: SmartTutorCloudVisuals | null;
};

export type SmartTutorSessionSummary = {
  id: string;
  title: string;
  topic: string;
  ended: boolean;
  preview?: string;
  createdAt: number;
  updatedAt: number;
};

const ChatMessageSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(["user", "tutor"]),
  text: z.string().max(20_000),
  at: z.number().finite(),
});

export const SmartTutorCloudSessionSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(120),
  topic: z.string().max(200),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  messages: z.array(ChatMessageSchema).max(200),
  objective: z.string().max(500).optional(),
  ended: z.boolean(),
  visuals: z.unknown().nullable(),
});

export type ParsedSmartTutorCloudSession = z.infer<
  typeof SmartTutorCloudSessionSchema
>;

const MAX_BYTES = 1_500_000;

export function previewFromSession(session: {
  topic: string;
  messages: Array<{ role: string; text: string }>;
}): string {
  const firstUser = session.messages.find((m) => m.role === "user")?.text?.trim();
  const text = firstUser || session.topic || "";
  return text.slice(0, 160);
}

/** Drop Blobs before uploading — URLs in figures/whiteboard stay. */
export function cloudVisualsFromLocal(
  visuals: SessionVisuals | null | undefined,
): SmartTutorCloudVisuals | null {
  if (!visuals) return null;
  return {
    formats: visuals.formats,
    plan: visuals.plan,
    board: visuals.board,
    draw: visuals.draw,
    drawings: visuals.drawings ?? [],
    sections: visuals.sections ?? [],
    stanzas: visuals.stanzas ?? [],
    figures: visuals.figures ?? {},
    whiteboard: visuals.whiteboard,
  };
}

export function toHistorySession(
  session: ParsedSmartTutorCloudSession,
): HistorySession {
  return {
    id: session.id,
    label: session.label,
    topic: session.topic,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages,
    ...(session.objective ? { objective: session.objective } : {}),
    ended: session.ended,
  };
}

export function toLocalVisuals(
  id: string,
  visuals: unknown,
): SessionVisuals | null {
  if (!visuals || typeof visuals !== "object") return null;
  const v = visuals as Partial<SmartTutorCloudVisuals>;
  return {
    id,
    savedAt: Date.now(),
    formats: v.formats,
    plan: (v.plan as VoiceLessonPlan | null | undefined) ?? null,
    board: (v.board as SessionVisuals["board"]) ?? null,
    draw: (v.draw as SessionVisuals["draw"]) ?? null,
    drawings: Array.isArray(v.drawings) ? v.drawings : [],
    sections: Array.isArray(v.sections) ? v.sections : [],
    stanzas: Array.isArray(v.stanzas) ? v.stanzas : [],
    figures:
      v.figures && typeof v.figures === "object"
        ? (v.figures as SessionVisuals["figures"])
        : {},
    whiteboard: (v.whiteboard as WhiteboardSession | null | undefined) ?? null,
    media: null,
    video: null,
  };
}

export function assertCloudSessionSize(session: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(session)).byteLength;
  if (bytes > MAX_BYTES) {
    throw new Error("This lesson is too large to save to your account.");
  }
}
