"use client";

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
};

/**
 * Voice presence shaped like the SeeThrough mark (bowl / wave logo).
 */
export function VoiceOrb({
  state,
  className,
  variant = "hero",
  showLabel = true,
}: VoiceOrbProps) {
  if (variant === "dock") {
    return (
      <div
        className={cn("flex flex-col items-center", className)}
        aria-label={STATE_LABEL[state]}
        role="img"
      >
        <div
          className={cn(
            "relative grid place-items-center transition-transform duration-500",
            (state === "listening" || state === "wake") && "scale-110",
            state === "speaking" && "scale-125",
            state === "thinking" && "scale-95 opacity-80",
            state === "idle" && "opacity-55",
            state === "connecting" && "animate-pulse",
            state === "error" && "opacity-90",
          )}
        >
          <span
            className={cn(
              "absolute size-16 rounded-full blur-xl transition-opacity",
              state === "speaking" && "bg-[#1b6ca8]/35",
              (state === "listening" || state === "wake") && "bg-[#5aa8ef]/30",
              state === "thinking" && "bg-[#9dbbd3]/25",
              state === "error" && "bg-[#c24545]/30",
              (state === "idle" || state === "connecting") && "bg-[#1b6ca8]/15",
            )}
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- brand mark as voice orb */}
          <img
            src="/SeeThrough_logo.png"
            alt=""
            className={cn(
              "relative size-14 object-contain drop-shadow-[0_8px_18px_rgba(27,108,168,0.22)] md:size-16",
              state === "speaking" &&
                "animate-[pulse_1.05s_ease-in-out_infinite]",
              (state === "listening" || state === "wake") &&
                "animate-[pulse_1.8s_ease-in-out_infinite]",
            )}
          />
        </div>
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
        {/* eslint-disable-next-line @next/next/no-img-element -- brand mark as voice orb */}
        <img
          src="/SeeThrough_logo.png"
          alt=""
          className={cn(
            "relative size-36 object-contain drop-shadow-[0_16px_40px_rgba(27,108,168,0.2)] md:size-44",
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
