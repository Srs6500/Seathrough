export { buildXRay, classifyFeatureKind, friendlyFeatureName, nodeBeginnerBlurb } from "@/lib/xray/buildXRay";
export { answerFeatureQuestion, heuristicFeatureAnswer, xrayAskSchema } from "@/lib/xray/explain";
export { askXRayFeature } from "@/lib/xray/client";
export type {
  XRayAskPayload,
  XRayAskResult,
  XRayEvidence,
  XRayFeature,
  XRayFeatureKind,
  XRayFeatureStatus,
  XRayFinding,
  XRayNode,
  XRayReport,
} from "@/lib/xray/types";
