/**
 * Continuous barge-in while the tutor speaks.
 *
 * Prefer Silero VAD (@ricky0123/vad-web) — speech probability, not raw energy —
 * so door knocks / TTS bleed are less likely to steal the turn. Falls back to
 * energy RMS if the model/worklet fails to load.
 */

export type BargeInHandle = {
  stop: () => void;
};

export type BargeInOptions = {
  onBargeIn: () => void;
  /**
   * Energy-fallback only (0–1). Ignored when Silero is active.
   * Higher = less sensitive.
   */
  threshold?: number;
  /** Ignore the first ms after arming (avoid click / first TTS frame). */
  settleMs?: number;
  /** Energy-fallback: require sustained energy for this many ms. */
  holdMs?: number;
  /**
   * Silero: probability 0–1 to count as speech. Higher resists speaker bleed.
   * Default ~0.55 (library default is 0.3 — too eager under TTS).
   */
  positiveSpeechThreshold?: number;
};

const VAD_WEB_CDN =
  "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/";
const ORT_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

type MicVADInstance = {
  start: () => Promise<void>;
  pause: () => void | Promise<void>;
  destroy: () => void | Promise<void>;
};

let warmPromise: Promise<boolean> | null = null;
/** null = unknown, true = assets reachable, false = use energy only */
let sileroAvailable: boolean | null = null;

function micConstraints(): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

/**
 * MicVAD.destroy() throws if start() never completed (null stream/context).
 * destroy/pause are async — must catch promise rejections, not only sync throws.
 */
function safeTeardownVad(instance: MicVADInstance | null) {
  if (!instance) return;
  void (async () => {
    try {
      await instance.pause();
    } catch {
      /* not listening / never started */
    }
    try {
      await instance.destroy();
    } catch {
      /* MicVAD throws when stream/context were never initialized */
    }
  })();
}

/**
 * Prefetch Silero worklet + onnx (and load the JS module). Do NOT construct
 * MicVAD just to destroy it — destroy() requires a successful start().
 */
export async function warmSileroVad(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (sileroAvailable != null) return sileroAvailable;
  if (warmPromise) return warmPromise;

  warmPromise = (async () => {
    try {
      await import("@ricky0123/vad-web");
      const assets = [
        `${VAD_WEB_CDN}vad.worklet.bundle.min.js`,
        `${VAD_WEB_CDN}silero_vad_v5.onnx`,
      ];
      await Promise.all(
        assets.map(async (url) => {
          const res = await fetch(url, { mode: "cors", cache: "force-cache" });
          if (!res.ok) throw new Error(`vad_asset_${res.status}`);
        }),
      );
      sileroAvailable = true;
      return true;
    } catch {
      sileroAvailable = false;
      return false;
    } finally {
      warmPromise = null;
    }
  })();

  return warmPromise;
}

export async function startBargeInListener(
  options: BargeInOptions,
): Promise<BargeInHandle> {
  if (typeof window === "undefined") {
    return { stop: () => undefined };
  }

  // Prefer Silero; fall back to energy on any load/runtime failure.
  try {
    if (sileroAvailable !== false) {
      return await startSileroBargeIn(options);
    }
  } catch {
    sileroAvailable = false;
  }
  return startEnergyBargeIn(options);
}

async function startSileroBargeIn(
  options: BargeInOptions,
): Promise<BargeInHandle> {
  const settleMs = options.settleMs ?? 180;
  const positiveSpeechThreshold = options.positiveSpeechThreshold ?? 0.55;
  const startedAt = performance.now();
  let alive = true;
  let fired = false;

  const { MicVAD } = await import("@ricky0123/vad-web");
  let vad: MicVADInstance | null = null;

  const stop = () => {
    if (!alive) return;
    alive = false;
    const instance = vad;
    vad = null;
    // destroy() throws if start() never finished — safeTeardownVad swallows that.
    safeTeardownVad(instance);
  };

  vad = (await MicVAD.new({
    model: "v5",
    startOnLoad: false,
    baseAssetPath: VAD_WEB_CDN,
    onnxWASMBasePath: ORT_WASM_CDN,
    positiveSpeechThreshold,
    negativeSpeechThreshold: Math.max(0.15, positiveSpeechThreshold - 0.2),
    minSpeechMs: 120,
    redemptionMs: 400,
    onSpeechStart: () => {
      if (!alive || fired) return;
      if (performance.now() - startedAt < settleMs) return;
      fired = true;
      options.onBargeIn();
      stop();
    },
    getStream: async () =>
      navigator.mediaDevices.getUserMedia({ audio: micConstraints() }),
  })) as MicVADInstance;

  if (!alive) {
    safeTeardownVad(vad);
    vad = null;
    return { stop: () => undefined };
  }

  await vad.start();
  sileroAvailable = true;

  if (!alive) {
    safeTeardownVad(vad);
    vad = null;
    return { stop: () => undefined };
  }

  return { stop };
}

function startEnergyBargeIn(options: BargeInOptions): BargeInHandle {
  const threshold = options.threshold ?? 0.14;
  const settleMs = options.settleMs ?? 180;
  const holdMs = options.holdMs ?? 90;
  const startedAt = performance.now();

  let alive = true;
  let hotSince: number | null = null;
  let fired = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;

  const stop = () => {
    if (!alive) return;
    alive = false;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (ctx) {
      void ctx.close().catch(() => undefined);
      ctx = null;
    }
  };

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints(),
      });
      if (!alive) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      ctx = new AudioContext();
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => undefined);
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      const tick = () => {
        if (!alive || fired || !ctx) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();
        if (now - startedAt < settleMs) {
          requestAnimationFrame(tick);
          return;
        }
        if (rms >= threshold) {
          if (hotSince == null) hotSince = now;
          if (now - hotSince >= holdMs) {
            fired = true;
            options.onBargeIn();
            stop();
            return;
          }
        } else {
          hotSince = null;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      stop();
    }
  })();

  return { stop };
}

export async function ensureMicPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: micConstraints(),
    });
    stream.getTracks().forEach((t) => t.stop());
    void warmSileroVad();
    return true;
  } catch {
    return false;
  }
}
