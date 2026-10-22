import { envPresence } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";
import {
  TOPIC_LOCK_SECONDS,
  planVoiceLesson,
  runVoiceTurn,
} from "@/lib/voice-tutor/brain";
import type { ChatMessage } from "@/lib/voice-tutor/sessionTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      userText?: unknown;
      messages?: unknown;
      topic?: unknown;
      activeTopic?: unknown;
      teaching?: unknown;
      awaitingFocus?: unknown;
      parentTopic?: unknown;
      focusOptions?: unknown;
      preferClarify?: unknown;
      clarifyAside?: unknown;
      partialAside?: unknown;
      deferredClose?: unknown;
      avoidedFocusOptions?: unknown;
      lessonContext?: unknown;
    };

    const mode =
      body.mode === "greet" || body.mode === "plan" || body.mode === "chat"
        ? body.mode
        : "chat";
    const userText = typeof body.userText === "string" ? body.userText.trim() : "";
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    const activeTopic =
      typeof body.activeTopic === "string" ? body.activeTopic.trim() : undefined;
    const teaching = body.teaching === true;
    const awaitingFocus = body.awaitingFocus === true;
    const preferClarify = body.preferClarify === true;
    const clarifyAside = body.clarifyAside === true;
    const partialAside = body.partialAside === true;
    const deferredClose = body.deferredClose === true;
    const avoidedFocusOptions = Array.isArray(body.avoidedFocusOptions)
      ? body.avoidedFocusOptions.filter(
          (o): o is string => typeof o === "string" && o.trim().length > 0,
        )
      : undefined;
    const rawCtx =
      body.lessonContext && typeof body.lessonContext === "object"
        ? (body.lessonContext as Record<string, unknown>)
        : null;
    const lessonContext = rawCtx
      ? {
          beatSay:
            typeof rawCtx.beatSay === "string" ? rawCtx.beatSay : undefined,
          highlight:
            typeof rawCtx.highlight === "string" ? rawCtx.highlight : undefined,
          rememberTip:
            typeof rawCtx.rememberTip === "string"
              ? rawCtx.rememberTip
              : undefined,
        }
      : undefined;
    const parentTopic =
      typeof body.parentTopic === "string" ? body.parentTopic.trim() : undefined;
    const focusOptions = Array.isArray(body.focusOptions)
      ? body.focusOptions.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : undefined;
    const messages = Array.isArray(body.messages)
      ? (body.messages as ChatMessage[]).filter(
          (m) =>
            m &&
            typeof m.id === "string" &&
            (m.role === "user" || m.role === "tutor") &&
            typeof m.text === "string",
        )
      : [];

    if (mode !== "greet" && !userText && !topic) {
      return Response.json({ error: "Say something to continue." }, { status: 400 });
    }

    if (mode === "plan") {
      const presence = envPresence();
      if (!presence.GROQ_API_KEY && !presence.OPENAI_API_KEY) {
        // Seed path still works for functions.
        const plan = await planVoiceLesson(topic || userText || "functions");
        return Response.json({
          say: `Alright — ${plan.topic}. Starting in a few seconds unless you change topics.`,
          action: "propose_topic",
          topic: plan.topic,
          label: plan.label,
          lockSeconds: TOPIC_LOCK_SECONDS,
          plan,
          showOnBoard: false,
        });
      }
      const turn = await runVoiceTurn({
        mode: "plan",
        userText: topic || userText,
        messages,
      });
      return Response.json(turn);
    }

    const turn = await runVoiceTurn({
      mode,
      userText,
      messages,
      activeTopic,
      teaching,
      awaitingFocus,
      parentTopic,
      focusOptions,
      preferClarify,
      clarifyAside,
      partialAside,
      deferredClose,
      avoidedFocusOptions,
      lessonContext,
    });
    return Response.json(turn);
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(error, "Couldn't continue the voice lesson."),
      },
      { status: 500 },
    );
  }
}
