"use client";

import { FileDown, Link2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SPEAK_MAX, type Plan } from "@/lib/explain-video/film";
import { INSPECT_CHIP, INSPECT_CHIP_ICON } from "@/lib/smart-tutor/chrome";
import { cn } from "@/lib/utils";
import { patchScene } from "@/components/explain-video/OutlineReview";

const FIELD =
  "rounded-lg border-[#ececee] bg-white text-[13px] text-[#16161a] shadow-none placeholder:text-[#71717a] focus-visible:border-[#ececee] focus-visible:ring-2 focus-visible:ring-[#5b4fd4]/30";

export type ShareState = "idle" | "sharing" | "copied" | "failed";
export type UpdateKind = "idle" | "redraw" | "film";

type SceneStudioProps = {
  plan: Plan;
  selected: number;
  onSelect: (index: number) => void;
  onPlan: (plan: Plan) => void;
  onRedraw: (index: number) => void;
  onUpdateFilm: () => void;
  onShare: () => void;
  onNew: () => void;
  videoUrl: string | null;
  downloadName: string;
  shareState: ShareState;
  shareUrl: string;
  updateKind: UpdateKind;
  canUpdate: boolean;
  error: string;
  status: string;
};

export function SceneStudio({
  plan,
  selected,
  onSelect,
  onPlan,
  onRedraw,
  onUpdateFilm,
  onShare,
  onNew,
  videoUrl,
  downloadName,
  shareState,
  shareUrl,
  updateKind,
  canUpdate,
  error,
  status,
}: SceneStudioProps) {
  const scene = plan.scenes[selected];
  const busy = updateKind !== "idle";
  const shareLabel =
    shareState === "sharing"
      ? "Creating link"
      : shareState === "copied"
        ? "Link copied"
        : shareState === "failed"
          ? "Try sharing again"
          : "Share link";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#ececee] px-4 py-3">
        <p className="text-[11px] font-medium tracking-[0.04em] text-[#71717a] uppercase">Scenes</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {plan.scenes.map((item, index) => (
            <button
              key={index}
              type="button"
              disabled={busy}
              onClick={() => onSelect(index)}
              className={cn(
                "inline-flex h-8 items-center rounded-lg px-2.5 text-[12px] font-medium",
                selected === index
                  ? "bg-[#f4f1ff] text-[#5b4fd4]"
                  : "bg-[#f4f4f6] text-[#16161a] hover:bg-[#ececee]",
              )}
            >
              {index + 1}. {item.title}
            </button>
          ))}
        </div>
      </div>

      {scene ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <label className="text-[12px] text-[#71717a]" htmlFor="studio-title">
            Title
          </label>
          <Input
            id="studio-title"
            value={scene.title}
            maxLength={48}
            disabled={busy}
            onChange={(event) => onPlan(patchScene(plan, selected, { title: event.target.value }))}
            className={cn("mt-1 h-8", FIELD)}
          />
          <label className="mt-3 block text-[12px] text-[#71717a]" htmlFor="studio-see">
            Picture
          </label>
          <Textarea
            id="studio-see"
            value={scene.see}
            maxLength={320}
            disabled={busy}
            onChange={(event) => onPlan(patchScene(plan, selected, { see: event.target.value }))}
            className={cn("mt-1 min-h-[5rem]", FIELD)}
          />
          <label className="mt-3 block text-[12px] text-[#71717a]" htmlFor="studio-say">
            On-screen caption
          </label>
          <Input
            id="studio-say"
            value={scene.say}
            maxLength={110}
            disabled={busy}
            onChange={(event) => onPlan(patchScene(plan, selected, { say: event.target.value }))}
            className={cn("mt-1 h-8", FIELD)}
          />
          <label className="mt-3 block text-[12px] text-[#71717a]" htmlFor="studio-speak">
            Narration
          </label>
          <Textarea
            id="studio-speak"
            value={scene.speak}
            maxLength={SPEAK_MAX}
            disabled={busy}
            onChange={(event) => onPlan(patchScene(plan, selected, { speak: event.target.value }))}
            className={cn("mt-1 min-h-[5rem]", FIELD)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !scene.see.trim()}
              onClick={() => onRedraw(selected)}
              className={INSPECT_CHIP_ICON}
            >
              {updateKind === "redraw" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              Redraw this picture
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !canUpdate}
              onClick={onUpdateFilm}
              className="h-9 rounded-lg bg-[#16161a] px-3 text-[13px] font-medium text-white hover:bg-[#2a2a2e] disabled:opacity-50"
            >
              {updateKind === "film" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              Update film
            </Button>
          </div>
        </div>
      ) : null}

      <div className="border-t border-[#ececee] px-4 py-3">
        {error ? (
          <p className="mb-2 rounded-lg border border-[#ececee] bg-white px-3 py-2 text-[13px] text-[#c24545]" role="alert">
            {error}
          </p>
        ) : (
          <p className="mb-2 text-[12px] text-[#71717a]" role="status">
            {shareState === "copied" && shareUrl ? (
              <a href={shareUrl} className="font-medium text-[#5b4fd4] underline-offset-2 hover:underline">
                {shareUrl.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              status
            )}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!videoUrl || busy || shareState === "sharing"}
            onClick={onShare}
            className={cn(
              INSPECT_CHIP_ICON,
              shareState === "copied" && "bg-[#f4f1ff] text-[#5b4fd4] hover:bg-[#f4f1ff]",
            )}
          >
            {shareState === "sharing" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
            {shareLabel}
          </Button>
          {videoUrl ? (
            <Button asChild type="button" variant="outline" size="sm" className={cn("gap-1.5", INSPECT_CHIP_ICON)}>
              <a href={videoUrl} download={downloadName}>
                <FileDown className="size-3.5" />
                Download
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onNew} className={INSPECT_CHIP}>
            New explainer
          </Button>
        </div>
      </div>
    </div>
  );
}
