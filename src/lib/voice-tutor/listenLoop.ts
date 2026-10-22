/**
 * Record until the user stops speaking (silence), then return the blob.
 * Skips tiny/noisy clips so we don't spam Deepgram with 400s.
 */

export type ListenLoopHandle = {
  stop: () => void;
};

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function rmsFromTimeDomain(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = (data[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

export async function listenUntilSilence(options?: {
  /** Speech energy threshold 0–1 */
  speechThreshold?: number;
  /** Silence to end utterance (ms) — longer = fewer mid-thought cutoffs */
  silenceMs?: number;
  /** Max record length (ms) */
  maxMs?: number;
  /** Must hear speech this long before silence can end (ms) */
  minSpeechMs?: number;
  signal?: AbortSignal;
  /** Reuse a session mic instead of opening a new one. */
  mediaStream?: MediaStream;
}): Promise<Blob | null> {
  const speechThreshold = options?.speechThreshold ?? 0.045;
  // Default ~3.5s so a short thinking pause ("I wanna learn about…") doesn't cut.
  // Cap around 5s via callers if needed — don't go higher.
  const silenceMs = options?.silenceMs ?? 3500;
  const maxMs = options?.maxMs ?? 20000;
  const minSpeechMs = options?.minSpeechMs ?? 500;
  const shared = Boolean(options?.mediaStream);

  if (options?.signal?.aborted) return null;

  const stream =
    options?.mediaStream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: MIC_CONSTRAINTS,
    }));
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const started = performance.now();
  let speechStartedAt: number | null = null;
  let lastLoudAt: number | null = null;
  let stopped = false;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    // Duplex owns the shared session mic — never stop its tracks here.
    if (!shared) {
      stream.getTracks().forEach((t) => t.stop());
    }
    void ctx.close().catch(() => undefined);
  };

  const onAbort = () => {
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* ignore */
    }
    cleanup();
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  return new Promise<Blob | null>((resolve) => {
    recorder.onstop = () => {
      cleanup();
      options?.signal?.removeEventListener("abort", onAbort);
      const blob = new Blob(chunks, { type: mime });
      // ~2KB is usually just noise / empty webm headers
      if (blob.size < 2500 || speechStartedAt == null) {
        resolve(null);
        return;
      }
      resolve(blob);
    };

    recorder.start(200);

    const tick = () => {
      if (stopped || options?.signal?.aborted) {
        onAbort();
        resolve(null);
        return;
      }
      analyser.getByteTimeDomainData(data);
      const rms = rmsFromTimeDomain(data);
      const now = performance.now();

      if (rms >= speechThreshold) {
        if (speechStartedAt == null) speechStartedAt = now;
        lastLoudAt = now;
      }

      const spokenLongEnough =
        speechStartedAt != null && now - speechStartedAt >= minSpeechMs;
      const silentLongEnough =
        lastLoudAt != null && now - lastLoudAt >= silenceMs;
      const timedOut = now - started >= maxMs;

      if ((spokenLongEnough && silentLongEnough) || timedOut) {
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          cleanup();
          resolve(null);
        }
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export { MIC_CONSTRAINTS };
