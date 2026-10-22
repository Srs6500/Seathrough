import { assessSpokenReasoning } from "@/lib/voice-tutor/assess";
import type {
  DisplayAction,
  LessonEvent,
  LessonStep,
  SlrLesson,
} from "@/lib/voice-tutor/schemas";

export type VoiceTutorPhase =
  | "idle"
  | "running"
  | "waiting"
  | "complete"
  | "error";

export type VoiceTutorSession = {
  sessionId: string;
  lesson: SlrLesson;
  revision: number;
  stepIndex: number;
  phase: VoiceTutorPhase;
  /** How many scaffold retries used on the current waiting step. */
  hintCount: number;
  lastPrompt: string | null;
};

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `vt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function blockById(lesson: SlrLesson, blockId: string) {
  return lesson.blocks.find((block) => block.id === blockId) ?? null;
}

function stepEvent(
  session: VoiceTutorSession,
  step: LessonStep,
): LessonEvent {
  return {
    event: "lesson.step",
    sessionId: session.sessionId,
    revision: session.revision,
    stepId: step.id,
    blockId: step.blockId,
    phase: step.phase,
    speech: { text: step.speech },
    display: step.display,
    expectResponse: step.expectResponse,
  };
}

export function createVoiceTutorSession(lesson: SlrLesson): VoiceTutorSession {
  return {
    sessionId: newSessionId(),
    lesson,
    revision: 0,
    stepIndex: -1,
    phase: "idle",
    hintCount: 0,
    lastPrompt: null,
  };
}

export function startVoiceTutorSession(
  session: VoiceTutorSession,
): { session: VoiceTutorSession; events: LessonEvent[] } {
  const events: LessonEvent[] = [
    {
      event: "lesson.loaded",
      lessonId: session.lesson.id,
      title: session.lesson.title,
      objective: session.lesson.objective,
      revision: 0,
    },
  ];
  return advanceToStep({ ...session, phase: "running", stepIndex: -1 }, events);
}

function advanceToStep(
  session: VoiceTutorSession,
  prior: LessonEvent[] = [],
): { session: VoiceTutorSession; events: LessonEvent[] } {
  const nextIndex = session.stepIndex + 1;
  const step = session.lesson.steps[nextIndex];
  if (!step) {
    const done: VoiceTutorSession = {
      ...session,
      revision: session.revision + 1,
      phase: "complete",
      stepIndex: nextIndex,
      lastPrompt: null,
    };
    return {
      session: done,
      events: [
        ...prior,
        {
          event: "lesson.complete",
          sessionId: done.sessionId,
          revision: done.revision,
          summary: session.lesson.objective,
        },
      ],
    };
  }

  const revision = session.revision + 1;
  const next: VoiceTutorSession = {
    ...session,
    revision,
    stepIndex: nextIndex,
    hintCount: 0,
    phase: step.expectResponse === "none" ? "running" : "waiting",
    lastPrompt:
      step.display.find((action): action is Extract<DisplayAction, { type: "ask" }> =>
        action.type === "ask",
      )?.prompt ??
      (step.expectResponse !== "none" ? step.speech : null),
  };

  const events: LessonEvent[] = [...prior, stepEvent(next, step)];
  if (next.phase === "waiting" && next.lastPrompt) {
    events.push({
      event: "lesson.waiting",
      sessionId: next.sessionId,
      revision: next.revision,
      stepId: step.id,
      prompt: next.lastPrompt,
    });
  }

  return { session: next, events };
}

/** Advance after a non-interactive step has finished speaking. */
export function continueVoiceTutorSession(
  session: VoiceTutorSession,
): { session: VoiceTutorSession; events: LessonEvent[] } {
  if (session.phase === "waiting") {
    return { session, events: [] };
  }
  if (session.phase === "complete" || session.phase === "idle") {
    return { session, events: [] };
  }
  return advanceToStep(session);
}

export function answerVoiceTutorSession(
  session: VoiceTutorSession,
  answer: string,
): { session: VoiceTutorSession; events: LessonEvent[] } {
  if (session.phase !== "waiting") {
    return {
      session,
      events: [
        {
          event: "lesson.error",
          message: "The tutor is not waiting for an answer right now.",
        },
      ],
    };
  }

  const step = session.lesson.steps[session.stepIndex];
  if (!step) {
    return {
      session: { ...session, phase: "error" },
      events: [{ event: "lesson.error", message: "Lesson step is missing." }],
    };
  }

  const block = blockById(session.lesson, step.blockId);
  if (!block) {
    return {
      session: { ...session, phase: "error" },
      events: [{ event: "lesson.error", message: "Lesson block is missing." }],
    };
  }

  const result = assessSpokenReasoning(block, answer);
  const revision = session.revision + 1;
  const feedback: LessonEvent = {
    event: "lesson.feedback",
    sessionId: session.sessionId,
    revision,
    understood: result.understood,
    speech: { text: result.speech },
  };

  if (result.understood) {
    const afterFeedback: VoiceTutorSession = {
      ...session,
      revision,
      phase: "running",
      hintCount: 0,
      lastPrompt: null,
    };
    return advanceToStep(afterFeedback, [feedback]);
  }

  const hintCount = session.hintCount + 1;
  // After two failed attempts, scaffold with the answer idea and move on.
  if (hintCount >= 2) {
    const scaffoldSpeech = `${result.speech} Here's the idea: ${block.lesson.formalStatement} Let's continue.`;
    const scaffolded: VoiceTutorSession = {
      ...session,
      revision,
      phase: "running",
      hintCount: 0,
      lastPrompt: null,
    };
    return advanceToStep(scaffolded, [
      {
        ...feedback,
        speech: { text: scaffoldSpeech },
      },
    ]);
  }

  return {
    session: {
      ...session,
      revision,
      phase: "waiting",
      hintCount,
    },
    events: [feedback],
  };
}

export function interruptVoiceTutorSession(
  session: VoiceTutorSession,
): VoiceTutorSession {
  // Bump revision so the client can drop stale speech/visual events.
  return {
    ...session,
    revision: session.revision + 1,
  };
}
