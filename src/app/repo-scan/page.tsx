import type { Metadata } from "next";
import { RepoScanWorkspace } from "@/components/repo-scan/RepoScanWorkspace";
import { repoScanMode } from "@/modules/repo-scan/mode";

export const metadata: Metadata = {
  title: repoScanMode.metaTitle,
  description: repoScanMode.metaDescription,
};

export default function RepoScanPage() {
  return <RepoScanWorkspace />;
}
