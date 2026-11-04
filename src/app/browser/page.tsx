import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { BrowserExperienceWorkspace } from "@/components/browser-experience/BrowserExperienceWorkspace";
import { browserExperienceMode } from "@/modules/browser-experience/mode";

export const metadata: Metadata = pageMetadata({
  title: browserExperienceMode.metaTitle,
  description: browserExperienceMode.metaDescription,
  path: "/browser",
});

export default function BrowserExperiencePage() {
  return <BrowserExperienceWorkspace />;
}
