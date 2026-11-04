import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { Workspace } from "@/modules/automatic-drawing";
import { automaticDrawingMode } from "@/modules/automatic-drawing/mode";

export const metadata: Metadata = {
  title: automaticDrawingMode.metaTitle,
  description: automaticDrawingMode.metaDescription,
  robots: NO_INDEX,
};

export default function AutomaticDrawingPage() {
  return (
    <Workspace />
  );
}
