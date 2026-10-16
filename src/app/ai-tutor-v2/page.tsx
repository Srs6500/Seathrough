import type { Metadata } from "next";
import { Workspace } from "@/modules/ai-tutor-v2";
import { aiTutorV2Mode } from "@/modules/ai-tutor-v2/mode";

export const metadata: Metadata = {
  title: aiTutorV2Mode.metaTitle,
  description: aiTutorV2Mode.metaDescription,
};

export default function AiTutorV2Page() {
  return <Workspace />;
}
