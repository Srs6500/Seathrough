/**
 * Pipecat-style duplex session for Voice Tutor.
 *
 * Owns one MediaStream for the active lesson. Coordinates listen ↔ speak
 * without tearing the mic down every turn. Pedagogy (brain/board/checks)
 * stays in the workspace — this module is only the continuous voice pipe.
 *
 * Wake mode: after idle, only wake phrases ("hey seethrough", "hey tutor")
 * re-open the active listen loop — other speech is ignored.
 */

import {
  ensureMicPermission,
  startBargeInListener,
  warmSileroVad,
  type BargeInHandle,
} from "@/lib/voice-tutor/bargeIn";
import { MIC_CONSTRAINTS } from "@/lib/voice-tutor/listenLoop";
import { streamListenUntilUtterance } from "@/lib/voice-tutor/streamListen";
import { streamSpeakTutorLine } from "@/lib/voice-tutor/streamSpeak";
import {
  DEFAULT_WAKE_PHRASES,
  matchesWakePhrase,
  type WakeMatch,
} from "@/lib/voice-tutor/wakeWord";

export type DuplexState =
  | "idle"
  | "wake"
  | "listening"
  | "thinking"
  | "speaking"
  | "paused"
  | "ended";

export type DuplexSessionHandlers = {
  onPartial?: (transcript: string) => void;
  /** Called with a final student utterance. Awaited before listen resumes. */
  onFinal?: (
    transcript: string,
    meta: { afterBarge: boolean },
  ) => void | Promise<void>;
  onState?: (state: DuplexState) => void;
  /** Fired when Silero/energy detects speech over tutor TTS. */
  onBarge?: () => void;
  /** Fired when a wake phrase is heard (before remainder is handled). */
  onWake?: (info: {
    phrase: string;
    remainder: string;
  }) => void | Promise<void>;
  onError?: (message: string) => void;
};

export type DuplexSessionOptions = DuplexSessionHandlers & {
  positiveSpeechThreshold?: number;
  bargeThreshold?: number;
  bargeSettleMs?: number;
  bargeHoldMs?: number;
  /** Drop to wake mode after this much idle time (ms). Default 45s. */
  idleTimeoutMs?: number;
  /** Disable wake gating (always active listen). Default true = enabled. */
  wakeWordEnabled?: boolean;
  wakePhrases?: readonly string[];
  /** Subject words (topic, focus options) to bias STT on each listen. */
  getKeyterms?: () => readonly string[];
};

export class VoiceDuplexSession {
  private handlers: DuplexSessionOptions;
  private stream: MediaStream | null = null;
  private state: DuplexState = "idle";
  private listenAc: AbortController | null = null;
  private speakAc: AbortController | null = null;
  private barge: BargeInHandle | null = null;
  private listenLoopActive = false;
  private wakeLoopActive = false;
  private postBarge = false;
  /** Student mic muted — tutor may still speak. */
  private studentMuted = true;
  private destroyed = false;
  private inWakeMode = false;
  private idleTimer: number | null = null;

  constructor(handlers: DuplexSessionOptions = {}) {
    this.handlers = handlers;
  }

  get duplexState(): DuplexState {
    return this.state;
  }

  get speaking(): boolean {
    return this.state === "speaking";
  }

  get listening(): boolean {
    return (
      this.state === "listening" ||
      this.state === "wake" ||
      this.listenLoopActive ||
      this.wakeLoopActive
    );
  }

  get isWakeMode(): boolean {
    return this.inWakeMode;
  }

  get hasMic(): boolean {
    return Boolean(this.stream?.getTracks().some((t) => t.readyState === "live"));
  }

  private get wakeEnabled(): boolean {
    return this.handlers.wakeWordEnabled !== false;
  }

  private get idleTimeoutMs(): number {
    return this.handlers.idleTimeoutMs ?? 45_000;
  }

  private get wakePhrases(): readonly string[] {
    return this.handlers.wakePhrases ?? DEFAULT_WAKE_PHRASES;
  }

  setHandlers(handlers: DuplexSessionOptions) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  setPostBarge(value: boolean) {
    this.postBarge = value;
  }

  private setState(next: DuplexState) {
    if (this.state === next) return;
    this.state = next;
    this.handlers.onState?.(next);
  }

  private clearIdleTimer() {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Reset idle countdown; when it fires, enter wake mode. */
  private bumpActivity() {
    this.clearIdleTimer();
    if (
      !this.wakeEnabled ||
      this.destroyed ||
      this.studentMuted ||
      this.inWakeMode ||
      this.state === "paused" ||
      this.state === "ended"
    ) {
      return;
    }
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      this.enterWakeMode();
    }, this.idleTimeoutMs);
  }

  /** Open (or reuse) the session mic. */
  async acquireMic(): Promise<boolean> {
    if (this.destroyed) return false;
    if (this.hasMic) {
      this.studentMuted = false;
      void warmSileroVad();
      return true;
    }
    const ok = await ensureMicPermission();
    if (!ok) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: MIC_CONSTRAINTS,
      });
      this.studentMuted = false;
      void warmSileroVad();
      return true;
    } catch {
      this.stream = null;
      return false;
    }
  }

  /** Student mute only — does not stop tutor TTS. */
  setStudentMuted(muted: boolean) {
    this.studentMuted = muted;
    if (muted) {
      this.clearIdleTimer();
      this.stopListening();
      this.barge?.stop();
      this.barge = null;
      this.inWakeMode = false;
      if (this.state !== "speaking" && this.state !== "paused") {
        this.setState("idle");
      }
    }
  }

  /** Hard pause (X): stop listen + speak. */
  pause() {
    this.clearIdleTimer();
    this.stopListening();
    this.abortSpeak();
    this.inWakeMode = false;
    this.setState("paused");
  }

  resumeListening() {
    if (this.destroyed || this.studentMuted) {
      this.setState("idle");
      return;
    }
    this.inWakeMode = false;
    if (this.state === "paused") this.setState("idle");
    this.startListening();
  }

  stopListening() {
    this.listenAc?.abort();
    this.listenAc = null;
    this.listenLoopActive = false;
    this.wakeLoopActive = false;
  }

  abortSpeak() {
    this.speakAc?.abort();
    this.speakAc = null;
    this.barge?.stop();
    this.barge = null;
    if (this.state === "speaking") {
      this.setState(
        this.studentMuted || this.destroyed
          ? "idle"
          : this.inWakeMode
            ? "wake"
            : "listening",
      );
    }
  }

  /** Drop into wake-phrase-only listening. */
  enterWakeMode() {
    if (this.destroyed || this.studentMuted || !this.wakeEnabled) return;
    if (this.state === "paused" || this.state === "ended") return;
    if (this.state === "speaking") return;
    this.clearIdleTimer();
    this.inWakeMode = true;
    this.stopListening();
    this.startWakeLoop();
  }

  /**
   * Continuous listen loop on the shared mic until a final transcript is
   * delivered to onFinal (or muted/paused/destroyed).
   */
  startListening() {
    if (this.destroyed || this.studentMuted) return;
    if (this.state === "paused" || this.state === "ended") return;
    if (this.state === "speaking") return;
    if (this.listenLoopActive || this.wakeLoopActive) return;
    if (!this.hasMic) {
      void this.acquireMic().then((ok) => {
        if (ok) this.startListening();
      });
      return;
    }

    this.inWakeMode = false;
    this.clearIdleTimer();
    this.listenLoopActive = true;
    const ac = new AbortController();
    this.listenAc = ac;
    this.setState("listening");

    void (async () => {
      try {
        while (
          !this.destroyed &&
          !this.studentMuted &&
          !ac.signal.aborted &&
          !this.inWakeMode &&
          this.state !== "paused" &&
          this.state !== "ended" &&
          this.state !== "speaking"
        ) {
          const listenAfterBarge = this.postBarge;
          let transcript: string | null = null;
          try {
            transcript = await streamListenUntilUtterance({
              signal: ac.signal,
              mediaStream: this.stream ?? undefined,
              utteranceEndMs: listenAfterBarge ? 1200 : 2500,
              endpointingMs: listenAfterBarge ? 500 : 750,
              maxMs: 20000,
              keyterms: this.handlers.getKeyterms?.(),
              onPartial: (partial) => this.handlers.onPartial?.(partial),
            });
          } catch {
            transcript = null;
          }

          if (ac.signal.aborted || this.destroyed || this.studentMuted) break;
          if (this.inWakeMode) break;
          if (
            (["speaking", "paused", "ended", "wake"] as DuplexState[]).includes(
              this.state,
            )
          ) {
            break;
          }

          if (!transcript) {
            this.setState("listening");
            continue;
          }

          const finalAfterBarge = this.postBarge;
          this.postBarge = false;
          this.setState("thinking");
          this.listenLoopActive = false;
          if (this.listenAc === ac) this.listenAc = null;

          try {
            await this.handlers.onFinal?.(transcript, {
              afterBarge: finalAfterBarge,
            });
          } catch (error) {
            this.handlers.onError?.(
              error instanceof Error ? error.message : "Couldn't continue.",
            );
          }
          this.bumpActivity();
          return;
        }
      } finally {
        if (this.listenAc === ac) this.listenAc = null;
        this.listenLoopActive = false;
        if (
          !this.destroyed &&
          !this.studentMuted &&
          !this.inWakeMode &&
          this.state !== "speaking" &&
          this.state !== "paused" &&
          this.state !== "ended" &&
          this.state !== "thinking" &&
          this.state !== "wake"
        ) {
          this.setState("listening");
          this.bumpActivity();
        }
      }
    })();
  }

  /**
   * Wake-phrase loop: STT runs, but only wake matches leave sleep.
   * Non-wake speech is discarded (not sent to the brain).
   */
  private startWakeLoop() {
    if (this.destroyed || this.studentMuted || !this.wakeEnabled) return;
    if (this.wakeLoopActive || this.listenLoopActive) return;
    if (!this.hasMic) {
      void this.acquireMic().then((ok) => {
        if (ok) this.startWakeLoop();
      });
      return;
    }

    this.wakeLoopActive = true;
    const ac = new AbortController();
    this.listenAc = ac;
    this.setState("wake");

    void (async () => {
      try {
        while (
          !this.destroyed &&
          !this.studentMuted &&
          !ac.signal.aborted &&
          this.inWakeMode &&
          this.state !== "paused" &&
          this.state !== "ended" &&
          this.state !== "speaking"
        ) {
          let transcript: string | null = null;
          // Box avoids TS narrowing `let` to `never` across the abort callback.
          const earlyBox: { hit: WakeMatch | null } = { hit: null };
          const utteranceAc = new AbortController();
          const onParentAbort = () => utteranceAc.abort();
          ac.signal.addEventListener("abort", onParentAbort);
          try {
            transcript = await streamListenUntilUtterance({
              signal: utteranceAc.signal,
              mediaStream: this.stream ?? undefined,
              utteranceEndMs: 1100,
              endpointingMs: 500,
              maxMs: 12000,
              keyterms: ["SeeThrough", ...this.wakePhrases],
              onPartial: (partial) => {
                const hit = matchesWakePhrase(partial, this.wakePhrases);
                if (hit.matched) {
                  earlyBox.hit = hit;
                  // Stop this utterance only — keep the wake loop controller alive.
                  utteranceAc.abort();
                }
              },
            });
          } catch {
            transcript = null;
          } finally {
            ac.signal.removeEventListener("abort", onParentAbort);
          }

          if (earlyBox.hit?.matched) {
            await this.handleWakeMatch(earlyBox.hit);
            return;
          }

          if (ac.signal.aborted || this.destroyed || this.studentMuted) break;
          if (!this.inWakeMode) break;

          if (!transcript) {
            this.setState("wake");
            continue;
          }

          const hit = matchesWakePhrase(transcript, this.wakePhrases);
          if (hit.matched) {
            await this.handleWakeMatch(hit);
            return;
          }

          // Non-wake speech while sleeping — ignore, keep waiting.
          this.setState("wake");
        }
      } finally {
        if (this.listenAc === ac) this.listenAc = null;
        this.wakeLoopActive = false;
        if (
          !this.destroyed &&
          !this.studentMuted &&
          this.inWakeMode &&
          this.state !== "speaking" &&
          this.state !== "paused" &&
          this.state !== "ended" &&
          this.state !== "listening" &&
          this.state !== "thinking"
        ) {
          // Loop ended without match (e.g. early abort race) — restart wake.
          if (this.inWakeMode) this.startWakeLoop();
        }
      }
    })();
  }

  private async handleWakeMatch(hit: {
    matched: boolean;
    phrase: string;
    remainder: string;
  }) {
    this.inWakeMode = false;
    this.wakeLoopActive = false;
    this.listenLoopActive = false;
    this.listenAc = null;
    this.clearIdleTimer();
    this.setState("listening");

    try {
      await this.handlers.onWake?.({
        phrase: hit.phrase,
        remainder: hit.remainder,
      });
    } catch (error) {
      this.handlers.onError?.(
        error instanceof Error ? error.message : "Couldn't wake the tutor.",
      );
    }

    if (this.destroyed || this.studentMuted || this.state === "paused") return;

    if (hit.remainder) {
      this.setState("thinking");
      try {
        await this.handlers.onFinal?.(hit.remainder, { afterBarge: false });
      } catch (error) {
        this.handlers.onError?.(
          error instanceof Error ? error.message : "Couldn't continue.",
        );
      }
      this.bumpActivity();
      return;
    }

    this.startListening();
    this.bumpActivity();
  }

  /**
   * Speak one tutor line. Arms barge-in when student mic is on.
   * Stops the listen loop for the duration of playback.
   * Pass `{ allowBarge: false }` for commit lines (topic lock) so trailing
   * speech after a subtopic pick can't cancel the start of the lesson.
   */
  async speak(
    text: string,
    opts?: { allowBarge?: boolean },
  ): Promise<boolean> {
    const clipped = text.trim();
    if (!clipped || this.destroyed) return false;
    if (this.state === "paused") return false;
    const allowBarge = opts?.allowBarge !== false;

    this.inWakeMode = false;
    this.clearIdleTimer();
    this.stopListening();
    this.abortSpeak();

    const ac = new AbortController();
    this.speakAc = ac;
    this.setState("speaking");

    try {
      const bargePromise =
        allowBarge && !this.studentMuted && this.hasMic
          ? startBargeInListener({
              positiveSpeechThreshold:
                this.handlers.positiveSpeechThreshold ?? 0.55,
              threshold: this.handlers.bargeThreshold ?? 0.14,
              settleMs: this.handlers.bargeSettleMs ?? 160,
              holdMs: this.handlers.bargeHoldMs ?? 80,
              onBargeIn: () => {
                this.postBarge = true;
                this.handlers.onBarge?.();
                this.abortSpeak();
              },
            })
              .then((handle) => {
                if (ac.signal.aborted) {
                  handle.stop();
                  return;
                }
                this.barge = handle;
              })
              .catch(() => undefined)
          : Promise.resolve();

      const speakPromise = streamSpeakTutorLine(clipped, ac.signal);
      await bargePromise;
      await speakPromise;
      return !ac.signal.aborted;
    } catch (error) {
      if ((error as Error)?.name === "AbortError" || ac.signal.aborted) {
        return false;
      }
      this.handlers.onError?.(
        error instanceof Error ? error.message : "Couldn't play that line.",
      );
      return false;
    } finally {
      this.barge?.stop();
      this.barge = null;
      if (this.speakAc === ac) this.speakAc = null;
      if (this.state === "speaking") {
        this.setState(
          this.studentMuted || this.destroyed ? "idle" : "listening",
        );
      }
      // bumpActivity no-ops when paused / muted / already in wake.
      this.bumpActivity();
    }
  }

  /** End session — stop tracks and never restart. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearIdleTimer();
    this.inWakeMode = false;
    this.stopListening();
    this.abortSpeak();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.studentMuted = true;
    this.setState("ended");
  }
}

export { ensureMicPermission };
