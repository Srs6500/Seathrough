import { getServiceSupabase } from "@/lib/supabase/server";
import {
  SmartTutorCloudSessionSchema,
  assertCloudSessionSize,
  previewFromSession,
  type ParsedSmartTutorCloudSession,
  type SmartTutorSessionSummary,
} from "@/lib/voice-tutor/smartTutorCloud";

const TABLE = "smart_tutor_sessions";
const SUMMARY_COLUMNS =
  "id, title, topic, ended, preview, created_at, client_updated_at";

/** Table from docs/supabase/011_smart_tutor_sessions.sql is missing. */
export class SmartTutorStoreMissing extends Error {
  constructor() {
    super("Smart tutor history storage is not set up in the database yet.");
  }
}

function isMissingRelation(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /smart_tutor_sessions/i.test(message) ||
    /schema cache/i.test(message)
  );
}

function fail(error: { message?: string; code?: string }): never {
  if (isMissingRelation(error)) throw new SmartTutorStoreMissing();
  throw error;
}

function msFromIso(value: unknown, fallback: number): number {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return fallback;
}

function rowToSummary(row: Record<string, unknown>): SmartTutorSessionSummary {
  const createdAt = msFromIso(row.created_at, Date.now());
  return {
    id: String(row.id),
    title: String(row.title || "Smart tutor"),
    topic: typeof row.topic === "string" ? row.topic : "",
    ended: row.ended === true,
    createdAt,
    updatedAt: msFromIso(row.client_updated_at, createdAt),
    ...(typeof row.preview === "string" && row.preview
      ? { preview: row.preview }
      : {}),
  };
}

function toRow(session: ParsedSmartTutorCloudSession, userId: string) {
  return {
    user_id: userId,
    id: session.id,
    title: session.label.slice(0, 120),
    topic: session.topic.slice(0, 200),
    ended: session.ended,
    preview: previewFromSession(session) || null,
    session,
    created_at: new Date(session.createdAt).toISOString(),
    client_updated_at: new Date(session.updatedAt).toISOString(),
  };
}

export async function listSmartTutorSessions(
  userId: string,
  limit = 40,
): Promise<SmartTutorSessionSummary[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
  const { data, error } = await getServiceSupabase()
    .from(TABLE)
    .select(SUMMARY_COLUMNS)
    .eq("user_id", userId)
    .order("client_updated_at", { ascending: false })
    .limit(safeLimit);
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToSummary);
}

export async function getSmartTutorSession(input: {
  userId: string;
  id: string;
}): Promise<ParsedSmartTutorCloudSession | null> {
  const { data, error } = await getServiceSupabase()
    .from(TABLE)
    .select(`${SUMMARY_COLUMNS}, session`)
    .eq("user_id", input.userId)
    .eq("id", input.id)
    .maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const parsed = SmartTutorCloudSessionSchema.safeParse(row.session);
  if (!parsed.success) return null;
  return parsed.data;
}

export async function upsertSmartTutorSession(
  userId: string,
  value: unknown,
): Promise<ParsedSmartTutorCloudSession> {
  const session = SmartTutorCloudSessionSchema.parse(value);
  assertCloudSessionSize(session);

  const client = getServiceSupabase();
  const { data: currentRow, error: readError } = await client
    .from(TABLE)
    .select("client_updated_at, session")
    .eq("user_id", userId)
    .eq("id", session.id)
    .maybeSingle();
  if (readError) fail(readError);

  if (currentRow) {
    const current = SmartTutorCloudSessionSchema.safeParse(
      (currentRow as Record<string, unknown>).session,
    );
    if (
      current.success &&
      current.data.updatedAt > session.updatedAt &&
      current.data.messages.length >= session.messages.length
    ) {
      return current.data;
    }
  }

  const { error } = await client.from(TABLE).upsert(toRow(session, userId), {
    onConflict: "user_id,id",
  });
  if (error) fail(error);
  return session;
}

export async function deleteSmartTutorSession(input: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const { data, error } = await getServiceSupabase()
    .from(TABLE)
    .delete()
    .eq("user_id", input.userId)
    .eq("id", input.id)
    .select("id")
    .maybeSingle();
  if (error) fail(error);
  return Boolean(data);
}
