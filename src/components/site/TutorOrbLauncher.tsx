"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { MorphOrb } from "@/components/voice-tutor/MorphOrb";
import { requestTutorAutostart } from "@/lib/voice-tutor/autostart";
import { cn } from "@/lib/utils";

const TUTOR_HREF = "/smart-tutor";
/** Matches the Smart Tutor page background, so the hand-off has no seam. */
const TUTOR_BG = "#f4f4f6";
/** Smart Tutor's docked orb centre sits this far above the viewport bottom. */
const DOCK_FROM_BOTTOM = 162;
/** MorphOrb's own footprint (px) and the size it's shown at in the navbar. */
const ORB_PX = 104;
/** Navbar size, as a fraction of the docked orb. */
const NAV_SCALE = 0.42;
const LAUNCH_MS = 700;
/** Longest we wait on the landing page for the mic prompt to be answered. */
const MIC_WAIT_MS = 12_000;

type Flight = { cx: number; cy: number; dx: number; dy: number; go: boolean };

/**
 * Small Smart Tutor orb for the navbar. Pressing it lifts the orb out of the
 * bar, grows it while it glides down to where the tutor docks its orb, fades
 * the page to the tutor canvas, then opens the tutor and starts talking.
 */
export function TutorOrbLauncher({
  className,
  scale = NAV_SCALE,
}: {
  className?: string;
  /** Size relative to the tutor's docked orb (navbar default ≈ 44px). */
  scale?: number;
}) {
  const router = useRouter();
  const homeRef = useRef<HTMLDivElement>(null);
  const [flight, setFlight] = useState<Flight | null>(null);

  useEffect(() => {
    router.prefetch(TUTOR_HREF);
  }, [router]);

  function launch() {
    if (flight) return;
    requestTutorAutostart();
    // Ask for the mic now, while this click still counts as a user gesture.
    // Asked later from the tutor page (no click there), Chrome shows only a
    // quiet address-bar chip, so the tutor would sit waiting on a hidden prompt.
    const micReady = askForMic();
    const home = homeRef.current;
    if (!home || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      void micReady.then(() => router.push(TUTOR_HREF));
      return;
    }
    const r = home.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    setFlight({
      cx,
      cy,
      dx: window.innerWidth / 2 - cx,
      dy: window.innerHeight - DOCK_FROM_BOTTOM - cy,
      go: false,
    });
    // Two frames: mount the flying orb at the navbar spot, then let it travel.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setFlight((f) => (f ? { ...f, go: true } : f))),
    );
    // Open the tutor once the flight lands and the mic prompt is answered.
    const landed = new Promise((resolve) => window.setTimeout(resolve, LAUNCH_MS));
    void Promise.all([landed, micReady]).then(() => router.push(TUTOR_HREF));
  }

  const size = Math.round(ORB_PX * scale);

  return (
    <>
      <div
        ref={homeRef}
        className={cn("relative shrink-0", className)}
        style={{ width: size, height: size, visibility: flight ? "hidden" : undefined }}
      >
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            width: ORB_PX,
            height: ORB_PX,
            marginLeft: -ORB_PX / 2,
            marginTop: -ORB_PX / 2,
            transform: `scale(${scale})`,
          }}
        >
          <MorphOrb
            state="wake"
            onPress={launch}
            /* Plain mic on hover, not the crossed-out "off" mic. */
            micOn
            pressLabel="Start the AI tutor"
          />
        </div>
      </div>

      {flight
        ? createPortal(
            <>
              <div
                aria-hidden
                className="pointer-events-none fixed inset-0 z-[100] transition-opacity ease-out"
                style={{
                  backgroundColor: TUTOR_BG,
                  opacity: flight.go ? 1 : 0,
                  transitionDuration: `${LAUNCH_MS - 200}ms`,
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none fixed z-[101] will-change-transform"
                style={{
                  left: flight.cx - ORB_PX / 2,
                  top: flight.cy - ORB_PX / 2,
                  width: ORB_PX,
                  height: ORB_PX,
                  transform: flight.go
                    ? `translate3d(${flight.dx}px, ${flight.dy}px, 0) scale(1)`
                    : `translate3d(0,0,0) scale(${scale})`,
                  transition: `transform ${LAUNCH_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`,
                }}
              >
                <MorphOrb state="connecting" />
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Resolve once the browser has an answer about the microphone (allowed or
 * not). The stream is closed straight away; the tutor opens its own.
 */
async function askForMic(): Promise<void> {
  const answer = navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => stream.getTracks().forEach((t) => t.stop()))
    .catch(() => {
      /* denied or no mic — the tutor shows its own "allow microphone" message */
    });
  // Don't hold the covered screen forever if the prompt is ignored.
  const giveUp = new Promise<void>((resolve) => window.setTimeout(resolve, MIC_WAIT_MS));
  await Promise.race([answer, giveUp]);
}
