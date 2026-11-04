import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SmartTutorWorkspace } from "@/components/smart-tutor/SmartTutorWorkspace";
import { smartTutorMode } from "@/modules/smart-tutor/mode";

export const metadata: Metadata = pageMetadata({
  title: smartTutorMode.metaTitle,
  description: smartTutorMode.metaDescription,
  path: "/smart-tutor",
});

export default function SmartTutorPage() {
  return <SmartTutorWorkspace />;
}
