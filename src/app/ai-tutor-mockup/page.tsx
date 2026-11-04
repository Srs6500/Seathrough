import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { TutorMockup } from "@/components/ai-tutor/TutorMockup";

export const metadata: Metadata = {
  title: "AI Tutor Mockup",
  description: "Visual mockup of the AI tutor landing screen.",
  robots: NO_INDEX,
};

export default function AiTutorMockupPage() {
  return <TutorMockup />;
}
