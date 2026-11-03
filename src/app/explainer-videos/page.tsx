import type { Metadata } from "next";
import { ExplainerVideosWorkspace } from "@/components/explainer-videos/ExplainerVideosWorkspace";
import { explainerVideosMode } from "@/modules/explainer-videos/mode";

export const metadata: Metadata = {
  title: explainerVideosMode.metaTitle,
  description: explainerVideosMode.metaDescription,
};

export default function ExplainerVideosPage() {
  return <ExplainerVideosWorkspace />;
}
