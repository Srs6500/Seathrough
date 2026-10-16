import type { Metadata } from "next";
import { BugAnalyzerWorkspace } from "@/components/bug-analyzer/BugAnalyzerWorkspace";
import { bugAnalyzerMode } from "@/modules/bug-analyzer/mode";

export const metadata: Metadata = {
  title: bugAnalyzerMode.metaTitle,
  description: bugAnalyzerMode.metaDescription,
};

export default function BugAnalyzerPage() {
  return <BugAnalyzerWorkspace />;
}
