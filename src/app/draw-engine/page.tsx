import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { Workspace } from "@/modules/draw-engine";
import { drawEngineMode } from "@/modules/draw-engine/mode";

export const metadata: Metadata = {
  title: drawEngineMode.metaTitle,
  description: drawEngineMode.metaDescription,
  robots: NO_INDEX,
};

export default function DrawEnginePage() {
  return (
    <Workspace />
  );
}
