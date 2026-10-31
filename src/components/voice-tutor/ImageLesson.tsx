"use client";

import { Box, ImageIcon, Loader2, X } from "lucide-react";
import { ModelViewer } from "@/components/voice-tutor/ModelViewer";
import { SceneViewport } from "@/components/scene-explain/SceneViewport";
import { cn } from "@/lib/utils";

export type LessonMedia =
  | { kind: "image"; imageUrl: string; subject?: string; error?: string }
  | {
      kind: "model3d";
      imageUrl: string;
      subject?: string;
      /** Tripo GLB, once its job finishes. */
      modelUrl?: string;
      /** Free path: generated Three.js code for the sandboxed scene viewer. */
      scene?: { title: string; brief: string; code: string; attempt: number };
      /** Tripo progress 0–100; undefined while the free path builds. */
      progress?: number;
      error?: string;
    };

/** Shown after a drop / pick: 3D, image as is, or cancel. */
export function ImageChoiceDialog({
  imageUrl,
  onChoose,
  onCancel,
}: {
  imageUrl: string;
  onChoose: (mode: "image" | "model3d") => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-choice-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[#ececee] bg-white p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="image-choice-title" className="text-[14px] font-semibold text-[#16161a]">
            Learn from this picture
          </h2>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onCancel}
            className="grid size-7 place-items-center rounded-md text-[#71717a] hover:bg-[#f4f4f6]"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        <img
          src={imageUrl}
          alt="Your picture"
          className="mb-4 max-h-56 w-full rounded-lg bg-[#f4f4f6] object-contain"
        />
        <div className="grid gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => onChoose("model3d")}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-[#16161a] text-[13px] font-medium text-white transition hover:bg-[#2a2a2e]"
          >
            <Box className="size-4" />
            Turn it into 3D
          </button>
          <button
            type="button"
            onClick={() => onChoose("image")}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[#ececee] bg-white text-[13px] font-medium text-[#16161a] transition hover:bg-[#fafafa]"
          >
            <ImageIcon className="size-4" />
            Use the image as is
          </button>
        </div>
        <p className="mt-3 text-center text-[12px] text-[#71717a]">
          3D takes about a minute. You can spin the model while we talk about it.
        </p>
      </div>
    </div>
  );
}

/** The student's picture or its 3D model, pinned above the lesson. */
export function LessonMediaCard({
  media,
  onClose,
  onSceneError,
}: {
  media: LessonMedia;
  onClose: () => void;
  /** Generated Three.js model crashed — the workspace repairs it. */
  onSceneError?: (message: string) => void;
}) {
  const scene = media.kind === "model3d" && !media.error ? media.scene : undefined;
  const built = media.kind === "model3d" && (media.modelUrl || scene);
  const building = media.kind === "model3d" && !built && !media.error;
  /** Flat picture still being identified by the vision model. */
  const analyzing = media.kind === "image" && !media.subject && !media.error;
  return (
    <figure className="relative overflow-hidden rounded-xl border border-[#ececee] bg-white">
      <button
        type="button"
        aria-label="Remove picture"
        onClick={onClose}
        className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-md bg-white/90 text-[#71717a] hover:bg-[#f4f4f6]"
      >
        <X className="size-4" />
      </button>
      {media.kind === "model3d" && media.modelUrl ? (
        <ModelViewer src={media.modelUrl} className="h-72 w-full cursor-grab active:cursor-grabbing" />
      ) : scene ? (
        <div className="h-72 w-full cursor-grab active:cursor-grabbing">
          <SceneViewport
            code={scene.code}
            frameKey={scene.attempt}
            reveal={1}
            onReady={() => undefined}
            onError={(message) => onSceneError?.(message)}
          />
        </div>
      ) : (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
          <img
            src={media.imageUrl}
            alt={media.subject || "Your picture"}
            className={cn(
              "h-72 w-full object-contain transition-opacity",
              (building || analyzing) && "opacity-40",
            )}
          />
          {analyzing ? (
            <div
              className="absolute inset-0 grid place-items-center"
              role="status"
              aria-live="polite"
            >
              <p className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-[13px] font-medium text-[#16161a] shadow-sm">
                <Loader2 className="size-4 animate-spin text-[#5b4fd4]" aria-hidden />
                Looking at your picture…
              </p>
            </div>
          ) : null}
          {building ? (
            <div className="absolute inset-0 grid place-items-center">
              <div className="w-48 text-center">
                <p className="mb-2 flex items-center justify-center gap-2 text-[13px] font-medium text-[#16161a]">
                  <Loader2 className="size-4 animate-spin text-[#5b4fd4]" aria-hidden />
                  Building 3D model…
                  {media.progress != null ? ` ${media.progress}%` : ""}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#ececee]">
                  <div
                    className={cn(
                      "h-full rounded-full bg-[#16161a] transition-[width] duration-500",
                      media.progress == null && "w-1/3 animate-pulse",
                    )}
                    style={
                      media.progress != null
                        ? { width: `${Math.max(4, media.progress)}%` }
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <figcaption className="border-t border-[#ececee] px-3 py-2 text-[12px] text-[#71717a]">
        {media.error
          ? media.error
          : built
            ? `${media.subject ? `${media.subject} · ` : ""}Drag to spin, scroll to zoom${scene ? " · AI sketch, not exact" : ""}`
            : media.subject || "Your picture"}
      </figcaption>
    </figure>
  );
}
