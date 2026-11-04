import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { ExperimentBoard } from "@/components/experiment/ExperimentBoard";

export const metadata: Metadata = {
  title: "Experiment",
  description: "Full-page whiteboard for experiments.",
  robots: NO_INDEX,
};

export default function ExperimentPage() {
  return <ExperimentBoard />;
}
