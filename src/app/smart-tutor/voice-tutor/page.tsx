import type { Metadata } from "next";
import { VoiceTutorWorkspace } from "@/components/voice-tutor/VoiceTutorWorkspace";
import { voiceTutorMode } from "@/modules/voice-tutor/mode";

export const metadata: Metadata = {
  title: voiceTutorMode.metaTitle,
  description: voiceTutorMode.metaDescription,
};

export default function VoiceTutorPage() {
  return <VoiceTutorWorkspace />;
}
