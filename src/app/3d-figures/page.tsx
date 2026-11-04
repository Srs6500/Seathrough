import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { Workspace } from "@/modules/figures-3d";
import { figures3dMode } from "@/modules/figures-3d/mode";

export const metadata: Metadata = {
  title: figures3dMode.metaTitle,
  description: figures3dMode.metaDescription,
  robots: NO_INDEX,
};

export default function ThreeDFiguresPage() {
  return <Workspace />;
}
