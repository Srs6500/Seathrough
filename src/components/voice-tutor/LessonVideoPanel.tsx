"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Download, Loader2, TriangleAlert } from "lucide-react";
import type {
  LessonVideoJob,
  LessonVideoStatus,
} from "@/components/voice-tutor/lessonVideo";
import { cn } from "@/lib/utils";

const CANCELLED: LessonVideoStatus = { kind: "cancelled" };

function statusLine(status: LessonVideoStatus): string {
  switch (status.kind) {
    case "planning":
      return "Writing the video script…";
    case "writing":
      return `Drawing ${status.scenes} scenes…`;
    case "checking":
      return `${status.detail}…`;
    case "filming":
      return `Filming — ${Math.round(status.progress * 100)}%`;
    default:
      return "";
  }
}

/** Video explainer for the active lesson: progress → live preview → player. */
export function LessonVideoPanel({
  job,
  className,
}: {
  job: LessonVideoJob;
  className?: string;
}) {
  const status = useSyncExternalStore(
    job.subscribe,
    job.getSnapshot,
    () => CANCELLED,
  );
  const previewRef = useRef<HTMLDivElement>(null);

  // Mount the job's own canvas so filming frames show live.
  useEffect(() => {
    const host = previewRef.current;
    if (!host || status.kind !== "filming") return;
    host.replaceChildren(job.canvas);
    return () => host.replaceChildren();
  }, [job, status.kind]);

  if (status.kind === "cancelled") return null;

  return (
    <section
      aria-label="Video explainer"
      className={cn(
        "overflow-hidden rounded-lg border border-[#ececee] bg-white",
        className,
      )}
    >
      <div className="flex h-10 items-center justify-between gap-3 border-b border-[#ececee] px-3">
        <p className="truncate text-[13px] font-medium text-[#16161a]">
          {status.kind === "ready" ? status.title : `Video: ${job.topic}`}
        </p>
        {status.kind === "ready" ? (
          <a
            href={status.url}
            download={status.fileName}
            className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[#5b4fd4] hover:underline"
          >
            <Download className="size-3.5" aria-hidden />
            Download
          </a>
        ) : null}
      </div>

      <div className="relative aspect-video w-full bg-[#f4f4f6]">
        {status.kind === "ready" ? (
          <video
            src={status.url}
            controls
            playsInline
            className="block h-full w-full bg-black"
          />
        ) : status.kind === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <TriangleAlert className="size-5 text-[#c24545]" aria-hidden />
            <p className="text-[13px] leading-snug text-[#16161a]">{status.message}</p>
          </div>
        ) : (
          <>
            <div ref={previewRef} className="absolute inset-0" />
            {status.kind !== "filming" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <Loader2 className="size-5 animate-spin text-[#5b4fd4]" aria-hidden />
                <p className="text-[13px] text-[#16161a]">{statusLine(status)}</p>
                <p className="text-[12px] text-[#71717a]">
                  This takes a minute or two — keep learning meanwhile.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>

      {status.kind === "filming" ? (
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#ececee]">
            <div
              className="h-full rounded-full bg-[#5b4fd4] transition-[width]"
              style={{ width: `${Math.round(status.progress * 100)}%` }}
            />
          </div>
          <p className="shrink-0 text-[12px] text-[#71717a]" aria-live="polite">
            {statusLine(status)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
