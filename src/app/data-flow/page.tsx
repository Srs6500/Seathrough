import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { DataFlowWorkspace } from "@/components/data-flow/DataFlowWorkspace";
import { dataFlowMode } from "@/modules/data-flow/mode";

export const metadata: Metadata = {
  title: dataFlowMode.metaTitle,
  description: dataFlowMode.metaDescription,
  robots: NO_INDEX,
};

export default function DataFlowPage() {
  return <DataFlowWorkspace />;
}
