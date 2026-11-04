import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { VibeCoderWorkspace } from "@/components/vibe-coder/VibeCoderWorkspace";
import { vibeCoderMode } from "@/modules/vibe-coder/mode";

export const metadata: Metadata = pageMetadata({
  title: vibeCoderMode.metaTitle,
  description: vibeCoderMode.metaDescription,
  path: "/vibe-coder",
});

export default function VibeCoderPage() {
  return <VibeCoderWorkspace />;
}
