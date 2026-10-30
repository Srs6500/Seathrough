"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/lms/BrandMark";
import { Button } from "@/components/ui/button";
import { INSPECT_CHIP } from "@/lib/smart-tutor/chrome";
import type { SavedLessonVideo } from "@/lib/experiment/savedVideos";
import { cn } from "@/lib/utils";

export function WatchExplainer({ video }: { video: SavedLessonVideo }) {
  useEffect(() => {
    document.documentElement.classList.add("video-explainer-page");
    return () => {
      document.documentElement.classList.remove("video-explainer-page");
    };
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f4f4f6] font-[family-name:var(--font-geist)] text-[#16161a]">
      <header className="flex shrink-0 items-start justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <BrandMark compact size="sm" className="[&>span]:text-[#16161a]" />
          <span className="inline-flex h-9 items-center rounded-lg bg-[#16161a] px-3 text-[13px] font-medium text-white">
            Video explainer
          </span>
        </div>
        <Button asChild type="button" variant="outline" size="sm" className={INSPECT_CHIP}>
          <Link href="/smart-tutor">Try Smart tutor</Link>
        </Button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-10">
        <div className="w-full max-w-[min(100%,calc((100dvh-10rem)*16/9))] overflow-hidden rounded-lg border border-[#ececee] bg-white">
          <div className="relative aspect-video w-full bg-[#16161a]">
            {video.videoUrl ? (
              <video
                src={video.videoUrl}
                poster={video.posterUrl}
                className="h-full w-full bg-[#16161a]"
                controls
                autoPlay
                playsInline
                aria-label={video.title}
              />
            ) : (
              <p className="flex h-full items-center justify-center px-6 text-center text-[13px] text-white/80">
                This explainer is no longer available.
              </p>
            )}
          </div>
          <div className="border-t border-[#ececee] px-4 py-3">
            <h1 className="text-[15px] font-medium tracking-[-0.01em] text-[#16161a]">{video.title}</h1>
            {video.question ? (
              <p className="mt-1 line-clamp-3 text-[13px] leading-5 text-[#71717a]">{video.question}</p>
            ) : null}
          </div>
        </div>
        <p className={cn("mt-4 max-w-xl text-center text-[13px] text-[#71717a]")}>
          Type an idea. Get a visual explanation worth sharing.
        </p>
      </main>
    </div>
  );
}
