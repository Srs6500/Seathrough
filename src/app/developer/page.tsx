import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { DeveloperOffice } from "@/components/developer/DeveloperOffice";
import { developerMode } from "@/modules/developer/mode";

export const metadata: Metadata = {
  title: developerMode.metaTitle,
  description: developerMode.metaDescription,
  robots: NO_INDEX,
};

export default function DeveloperPage() {
  return <DeveloperOffice />;
}
