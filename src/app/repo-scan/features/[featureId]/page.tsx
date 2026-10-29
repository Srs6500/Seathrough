import type { Metadata } from "next";
import { FeatureDetailPage } from "@/components/repo-scan/FeatureDetailPage";

export const metadata: Metadata = {
  title: "Feature | Repo-Scan",
  description: "Verification details for a scanned repository feature.",
};

export default async function RepoScanFeaturePage({
  params,
}: {
  params: Promise<{ featureId: string }>;
}) {
  const { featureId } = await params;
  return <FeatureDetailPage featureId={decodeURIComponent(featureId)} />;
}
