import type { Metadata } from "next";
import { SmartTutorWorkspace } from "@/components/smart-tutor/SmartTutorWorkspace";
import { smartTutorMode } from "@/modules/smart-tutor/mode";

export const metadata: Metadata = {
  title: smartTutorMode.metaTitle,
  description: smartTutorMode.metaDescription,
};

export default function SmartTutorPage() {
  return <SmartTutorWorkspace />;
}
