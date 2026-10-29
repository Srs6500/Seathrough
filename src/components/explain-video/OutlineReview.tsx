"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  LOOKS,
  LOOK_COLORS,
  SPEAK_MAX,
  type Look,
  type Plan,
  type PlanScene,
} from "@/lib/explain-video/film";
import { INSPECT_CHIP } from "@/lib/smart-tutor/chrome";
import { cn } from "@/lib/utils";

const FIELD =
  "rounded-lg border-[#ececee] bg-white text-[13px] text-[#16161a] shadow-none placeholder:text-[#71717a] focus-visible:border-[#ececee] focus-visible:ring-2 focus-visible:ring-[#5b4fd4]/30";

export function patchScene(plan: Plan, index: number, patch: Partial<PlanScene>): Plan {
  return {
    ...plan,
    scenes: plan.scenes.map((scene, sceneIndex) => (sceneIndex === index ? { ...scene, ...patch } : scene)),
  };
}

export function outlineReady(plan: Plan): boolean {
  if (!plan.title.trim() || !plan.angle.trim() || plan.scenes.length < 3) return false;
  return plan.scenes.every(
    (scene) => scene.title.trim() && scene.see.trim() && scene.say.trim() && scene.speak.trim(),
  );
}

type OutlineReviewProps = {
  plan: Plan;
  onPlan: (plan: Plan) => void;
  onBack: () => void;
  onGenerate: () => void;
  busy: boolean;
  error: string;
};

export function OutlineReview({ plan, onPlan, onBack, onGenerate, busy, error }: OutlineReviewProps) {
  const ready = outlineReady(plan);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#ececee] px-4 py-3">
        <p className="text-[11px] font-medium tracking-[0.04em] text-[#71717a] uppercase">
          {plan.scenes.length === 5 ? "Five-scene outline" : `${plan.scenes.length}-scene outline`}
        </p>
        <label className="sr-only" htmlFor="film-title">
          Film title
        </label>
        <Input
          id="film-title"
          value={plan.title}
          maxLength={60}
          disabled={busy}
          onChange={(event) => onPlan({ ...plan, title: event.target.value })}
          className={cn("mt-2 h-9", FIELD)}
        />
        <label className="mt-3 block text-[12px] text-[#71717a]" htmlFor="film-angle">
          What this film teaches
        </label>
        <Textarea
          id="film-angle"
          value={plan.angle}
          maxLength={200}
          disabled={busy}
          onChange={(event) => onPlan({ ...plan, angle: event.target.value })}
          className={cn("mt-1 min-h-[4.25rem]", FIELD)}
        />
        <p className="mt-3 text-[12px] text-[#71717a]">Look</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {LOOKS.map((look) => (
            <button
              key={look}
              type="button"
              disabled={busy}
              onClick={() => onPlan({ ...plan, look })}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium capitalize",
                plan.look === look
                  ? "border-transparent bg-[#f4f1ff] text-[#5b4fd4]"
                  : "border-[#ececee] bg-white text-[#16161a] hover:bg-[#fafafa]",
              )}
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: LOOK_COLORS[look as Look].accent }}
                aria-hidden
              />
              {look}
            </button>
          ))}
        </div>
      </div>

      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {plan.scenes.map((scene, index) => (
          <li key={index} className="rounded-lg border border-[#ececee] bg-[#fafafa] p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium text-[#5b4fd4]">Scene {index + 1}</span>
              <span className="text-[11px] text-[#71717a]">{scene.seconds.toFixed(0)}s</span>
            </div>
            <Input
              aria-label={`Scene ${index + 1} title`}
              value={scene.title}
              maxLength={48}
              disabled={busy}
              onChange={(event) => onPlan(patchScene(plan, index, { title: event.target.value }))}
              className={cn("mt-2 h-8", FIELD)}
            />
            <label className="mt-2 block text-[12px] text-[#71717a]">Picture</label>
            <Textarea
              aria-label={`Scene ${index + 1} picture`}
              value={scene.see}
              maxLength={320}
              disabled={busy}
              onChange={(event) => onPlan(patchScene(plan, index, { see: event.target.value }))}
              className={cn("mt-1 min-h-[4.5rem]", FIELD)}
            />
            <label className="mt-2 block text-[12px] text-[#71717a]">On-screen caption</label>
            <Input
              aria-label={`Scene ${index + 1} caption`}
              value={scene.say}
              maxLength={110}
              disabled={busy}
              onChange={(event) => onPlan(patchScene(plan, index, { say: event.target.value }))}
              className={cn("mt-1 h-8", FIELD)}
            />
            <label className="mt-2 block text-[12px] text-[#71717a]">Narration</label>
            <Textarea
              aria-label={`Scene ${index + 1} narration`}
              value={scene.speak}
              maxLength={SPEAK_MAX}
              disabled={busy}
              onChange={(event) => onPlan(patchScene(plan, index, { speak: event.target.value }))}
              className={cn("mt-1 min-h-[4.5rem]", FIELD)}
            />
          </li>
        ))}
      </ol>

      <div className="border-t border-[#ececee] px-4 py-3">
        {error ? (
          <p className="mb-2 rounded-lg border border-[#ececee] bg-white px-3 py-2 text-[13px] text-[#c24545]" role="alert">
            {error}
          </p>
        ) : (
          <p className="mb-2 text-[12px] text-[#71717a]" role="status">
            {busy
              ? "Drawing scenes and recording narration"
              : "Edit freely. Generate when the five beats feel right."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onBack} className={INSPECT_CHIP}>
            Back
          </Button>
          <Button
            type="button"
            disabled={busy || !ready}
            aria-busy={busy}
            onClick={onGenerate}
            className="h-9 rounded-lg bg-[#16161a] px-3 text-[13px] font-medium text-white hover:bg-[#2a2a2e]"
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {busy ? "Generating" : "Generate visuals and narration"}
          </Button>
        </div>
      </div>
    </div>
  );
}
