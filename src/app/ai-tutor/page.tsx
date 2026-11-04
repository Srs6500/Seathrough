import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { Workspace } from "@/modules/ai-tutor";
import { aiTutorMode } from "@/modules/ai-tutor/mode";

export const metadata: Metadata = {
  title: aiTutorMode.metaTitle,
  description: aiTutorMode.metaDescription,
  robots: NO_INDEX,
};

export default function AiTutorPage() {
  return <Workspace />;
}
