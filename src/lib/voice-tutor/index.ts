export {
  DEFAULT_VOICE_TUTOR_LESSON_ID,
  getDefaultVoiceTutorLesson,
  getVoiceTutorLesson,
  listVoiceTutorLessons,
} from "@/lib/voice-tutor/lessons";
export { assessSpokenReasoning } from "@/lib/voice-tutor/assess";
export { functionsVoicePlan, planVoiceLesson, runVoiceTurn } from "@/lib/voice-tutor/brain";
export {
  answerVoiceTutorSession,
  continueVoiceTutorSession,
  createVoiceTutorSession,
  interruptVoiceTutorSession,
  startVoiceTutorSession,
  type VoiceTutorPhase,
  type VoiceTutorSession,
} from "@/lib/voice-tutor/orchestrator";
export type {
  BoardAnnotation,
  BoardContent,
  ChatMessage,
  DrawScene,
  HistorySession,
  TeachBeat,
  TurnResponse,
  VoiceLessonPlan,
  VoicePhase,
} from "@/lib/voice-tutor/sessionTypes";
export {
  BoardAnnotationSchema,
  BoardContentSchema,
  ChatMessageSchema,
  DrawSceneSchema,
  TeachBeatSchema,
  TurnResponseSchema,
  VoiceLessonPlanSchema,
} from "@/lib/voice-tutor/sessionTypes";
export {
  buildBoardAnnotations,
  normalizeBoardAnnotations,
  resolveExactPhrase,
  withNormalizedAnnotations,
} from "@/lib/voice-tutor/boardAnnotations";
export {
  attachVoiceDiagrams,
  drawPolicyStub,
  type DiagramPolicy,
} from "@/lib/voice-tutor/attachDiagrams";
export {
  looksLikeVfptElectricTopic,
  pickVfptForVoiceTutor,
  VFPT_VOICE_MIN_SCORE,
} from "@/lib/voice-tutor/vfptGate";
export { packGutterPlacements } from "@/lib/voice-tutor/gutterLayout";
