import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchExplainer } from "@/components/explain-video/WatchExplainer";
import { getPublicExplainVideo, isSavedVideoId } from "@/lib/experiment/savedVideos";
import { NO_INDEX, pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isSavedVideoId(id)) {
    return { title: "Explainer", robots: NO_INDEX };
  }
  try {
    const video = await getPublicExplainVideo(id);
    if (!video) return { title: "Explainer", robots: NO_INDEX };
    // Shared user videos: good link previews, but kept out of search until we
    // publish curated, permanent explainer pages.
    return {
      ...pageMetadata({
        title: video.title,
        description: video.question || "A visual explanation from SeeThrough.",
        path: `/video/${id}`,
      }),
      robots: NO_INDEX,
    };
  } catch {
    return { title: "Explainer", robots: NO_INDEX };
  }
}

export default async function SharedExplainerPage({ params }: PageProps) {
  const { id } = await params;
  if (!isSavedVideoId(id)) notFound();
  let video;
  try {
    video = await getPublicExplainVideo(id);
  } catch {
    notFound();
  }
  if (!video) notFound();
  return <WatchExplainer video={video} />;
}
