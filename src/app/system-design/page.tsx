import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { ExperimentBoard } from "@/components/experiment/ExperimentBoard";
import { systemDesignMode } from "@/modules/system-design/mode";

export const metadata: Metadata = pageMetadata({
  title: systemDesignMode.metaTitle,
  description: systemDesignMode.metaDescription,
  path: "/system-design",
});

export default async function SystemDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { session } = await searchParams;
  const sessionId = typeof session === "string" && session ? session : undefined;
  return <ExperimentBoard kind="system" sessionId={sessionId} />;
}
