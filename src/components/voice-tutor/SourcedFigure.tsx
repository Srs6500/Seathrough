"use client";

import { ExternalLink } from "lucide-react";
import type { TeachingImage } from "@/lib/voice-tutor/images/types";
import { cn } from "@/lib/utils";

/** A credible-source picture under a lesson paragraph, with full attribution. */
export function SourcedFigure({ image, className }: { image: TeachingImage; className?: string }) {
  return (
    <figure className={cn("vt-sourced-figure m-0 mt-5", className)}>
      <div className="overflow-hidden rounded-xl border border-[#ececee] bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote, licensed source image */}
        <img
          src={image.url}
          alt={image.alt}
          width={image.width}
          height={image.height}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mx-auto max-h-[22rem] w-auto object-contain"
        />
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] leading-5">
        <span className="font-medium text-[#16161a]">{image.caption}</span>
        <a
          href={image.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-[#71717a] underline-offset-4 hover:underline"
        >
          <span className="truncate">
            {image.sourceName} · {image.credit}
            {image.license ? ` · ${image.license}` : ""}
          </span>
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}
