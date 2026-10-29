import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchExplainer } from "@/components/explain-video/WatchExplainer";
import { getPublicExplainVideo, isSavedVideoId } from "@/lib/experiment/savedVideos";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isSavedVideoId(id)) {
    return { title: "Explainer | SeeThrough" };
  }
  try {
    const video = await getPublicExplainVideo(id);
    if (!video) return { title: "Explainer | SeeThrough" };
    return {
      title: `${video.title} | SeeThrough`,
      description: video.question || "A visual explanation from SeeThrough.",
    };
  } catch {
    return { title: "Explainer | SeeThrough" };
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
