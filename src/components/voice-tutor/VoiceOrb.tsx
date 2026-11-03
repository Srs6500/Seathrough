"use client";

import { MorphOrb } from "@/components/voice-tutor/MorphOrb";
import { cn } from "@/lib/utils";

export type VoiceOrbState =
  | "idle"
  | "connecting"
  | "wake"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

const STATE_LABEL: Record<VoiceOrbState, string> = {
  idle: "Mic off",
  connecting: "Starting…",
  wake: "Say “hey SeeThrough”",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking — interrupt anytime",
  error: "Something went wrong",
};

type VoiceOrbProps = {
  state: VoiceOrbState;
  className?: string;
  /** Units-style: small bottom presence, not a hero blob. */
  variant?: "hero" | "dock";
  showLabel?: boolean;
  /** Dock only: tapping the orb toggles the mic. */
  onPress?: () => void;
  micOn?: boolean;
  pressLabel?: string;
  /** Dock only: a lesson is loading — the orb flies to it and loads there. */
  loadingLabel?: string | null;
};

/**
 * Voice presence: a round gradient orb that reacts to mic / tutor state.
 */
export function VoiceOrb({
  state,
  className,
  variant = "hero",
  showLabel = true,
  onPress,
  micOn,
  pressLabel,
  loadingLabel,
}: VoiceOrbProps) {
  if (variant === "dock") {
    // Morphs into a dotted "thinking" sphere, then condenses back on answer.
    return (
      <div className={cn("flex flex-col items-center", className)}>
        <MorphOrb
          state={state}
          onPress={onPress}
          micOn={micOn}
          pressLabel={pressLabel}
          loadingLabel={loadingLabel}
        />
        {showLabel ? (
          <p className="mt-1 text-[11px] text-muted" aria-live="polite">
            {STATE_LABEL[state]}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div
        className="relative grid place-items-center"
        aria-label={STATE_LABEL[state]}
        role="img"
      >
        <span
          className={cn(
            "absolute size-[14rem] rounded-full blur-3xl transition-opacity duration-500 md:size-[16rem]",
            state === "speaking" && "animate-pulse bg-[#7ec2f0]/40",
            (state === "listening" || state === "wake") &&
              "animate-pulse bg-[#9fd0ff]/35",
            state === "thinking" && "bg-[#b7d7f0]/30",
            state === "idle" && "bg-[#cfe4f5]/45",
            state === "connecting" && "animate-pulse bg-[#9fd0ff]/30",
            state === "error" && "bg-[#f0c2c2]/35",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "relative size-32 rounded-full bg-[radial-gradient(circle_at_35%_30%,#9fd0ff_0%,#1b6ca8_55%,#0d3f6b_100%)] shadow-[0_16px_40px_rgba(27,108,168,0.25)] md:size-40",
            (state === "listening" || state === "wake") &&
              "scale-[1.03] animate-[pulse_1.8s_ease-in-out_infinite]",
            state === "speaking" &&
              "scale-[1.06] animate-[pulse_1.05s_ease-in-out_infinite]",
            state === "thinking" && "scale-[0.98] opacity-95",
            state === "idle" && "opacity-95",
            state === "error" && "opacity-80",
          )}
        />
      </div>
      {showLabel ? (
        <p
          className="text-[13px] font-medium tracking-[-0.01em] text-muted"
          aria-live="polite"
        >
          {STATE_LABEL[state]}
        </p>
      ) : null}
    </div>
  );
}
