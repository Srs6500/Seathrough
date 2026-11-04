import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { Workspace } from "@/modules/ai-tutor-v2";
import { aiTutorV2Mode } from "@/modules/ai-tutor-v2/mode";

export const metadata: Metadata = {
  title: aiTutorV2Mode.metaTitle,
  description: aiTutorV2Mode.metaDescription,
  robots: NO_INDEX,
};

export default function AiTutorV2Page() {
  return <Workspace />;
}
