import type { Metadata } from "next";
import { VibeCoderWorkspace } from "@/components/vibe-coder/VibeCoderWorkspace";
import { vibeCoderMode } from "@/modules/vibe-coder/mode";

export const metadata: Metadata = {
  title: vibeCoderMode.metaTitle,
  description: vibeCoderMode.metaDescription,
};

export default function VibeCoderPage() {
  return <VibeCoderWorkspace />;
}
