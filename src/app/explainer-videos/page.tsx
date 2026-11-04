import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { ExplainerVideosWorkspace } from "@/components/explainer-videos/ExplainerVideosWorkspace";
import { explainerVideosMode } from "@/modules/explainer-videos/mode";

export const metadata: Metadata = {
  title: explainerVideosMode.metaTitle,
  description: explainerVideosMode.metaDescription,
  robots: NO_INDEX,
};

export default function ExplainerVideosPage() {
  return <ExplainerVideosWorkspace />;
}
