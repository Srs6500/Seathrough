import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { SavedVideosDashboard, type DashboardTab } from "@/components/dashboard/SavedVideosDashboard";
import { dashboardMode } from "@/modules/dashboard/mode";

export const metadata: Metadata = {
  title: dashboardMode.metaTitle,
  description: dashboardMode.metaDescription,
  robots: NO_INDEX,
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab } = await searchParams;
  const initialTab: DashboardTab =
    tab === "explain" || tab === "designs" ? tab : "lessons";
  return <SavedVideosDashboard initialTab={initialTab} />;
}
