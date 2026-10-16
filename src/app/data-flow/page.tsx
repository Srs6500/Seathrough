import type { Metadata } from "next";
import { DataFlowWorkspace } from "@/components/data-flow/DataFlowWorkspace";
import { dataFlowMode } from "@/modules/data-flow/mode";

export const metadata: Metadata = {
  title: dataFlowMode.metaTitle,
  description: dataFlowMode.metaDescription,
};

export default function DataFlowPage() {
  return <DataFlowWorkspace />;
}
