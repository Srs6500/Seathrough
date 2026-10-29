"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { BrandMark } from "@/components/lms/BrandMark";
import { StudyMenu } from "@/components/modes/ModeNav";
import { Button } from "@/components/ui/button";
import { OutlineReview, outlineReady } from "@/components/explain-video/OutlineReview";
import { PromptComposer } from "@/components/explain-video/PromptComposer";
import { SceneStudio, type ShareState, type UpdateKind } from "@/components/explain-video/SceneStudio";
import { INSPECT_CHIP_ICON } from "@/lib/smart-tutor/chrome";
import { cn } from "@/lib/utils";
import { directFilm, filmEngineConfig, type DirectorStatus } from "@/components/explain-video/direct";
import { FilmEngine } from "@/components/explain-video/engine";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  paintHold,
  paintPlan,
  type FontSet,
} from "@/components/explain-video/paint";
import { shootFilm } from "@/components/explain-video/shoot";
import { mixNarration, recordNarration, type Narration } from "@/components/explain-video/voice";
import {
  planSchema,
  retimeToVoice,
  sceneCodeResponseSchema,
  TOPIC_MAX,
  type Plan,
} from "@/lib/explain-video/film";

const FALLBACK_FONTS: FontSet = {
  display: "Georgia, serif",
  sans: "Inter, sans-serif",
  mono: "ui-monospace, monospace",
};

const WRITE_FAILED = "The film could not be written. Try again in a moment.";
const DRAW_FAILED = "The film could not be drawn. Try again in a moment.";
const DASHBOARD_TAB = "/dashboard?tab=explain";

type Phase = "prompt" | "planning" | "outline" | "writing" | "checking" | "filming" | "studio";

const DRAWING: Phase[] = ["writing", "checking", "filming"];

type Finished = { blob: Blob; plan: Plan; topic: string; durationMs: number; poster: Blob | null };
type Quality = { fps: 12 | 24; width: number };

function readFonts(): FontSet {
  const css = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    display: pick("--font-fraunces", FALLBACK_FONTS.display),
    sans: pick("--font-geist", FALLBACK_FONTS.sans),
    mono: pick("--font-ibm-plex-mono", FALLBACK_FONTS.mono),
  };
}

function firstFamily(stack: string): string {
  const part = stack.split(",")[0]?.trim() ?? stack;
  return part.replace(/^["']|["']$/g, "") || stack;
}

async function ensureFonts(fonts: FontSet): Promise<void> {
  await document.fonts.ready;
  await Promise.all([
    document.fonts.load(`600 72px "${firstFamily(fonts.display)}"`),
    document.fonts.load(`400 32px "${firstFamily(fonts.sans)}"`),
    document.fonts.load(`500 28px "${firstFamily(fonts.mono)}"`),
  ]).catch(() => undefined);
}

function listScenes(indexes: number[]): string {
  const numbers = indexes.map((index) => index + 1);
  return numbers.length === 1 ? `Scene ${numbers[0]}` : `Scenes ${numbers.join(", ")}`;
}

function narrationGap(narration: Narration, voiced: boolean, total: number): string {
  if (!narration.ok) return `No narration (${narration.reason}); the film has captions only.`;
  if (!voiced) return "The narration could not be encoded; the film has captions only.";
  const silent = Array.from({ length: total }, (_, index) => index).filter((index) => !narration.clips[index]);
  if (!silent.length) return "";
  return `${listScenes(silent)} ${silent.length === 1 ? "has" : "have"} no narration.`;
}

function fileSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "explanation";
}

async function postJson(url: string, body: unknown, fallback: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`${fallback.replace(/ Try again in a moment\.$/, "")} Check your connection and try again.`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : fallback;
    throw new Error(message);
  }
  return payload;
}

function capturePoster(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const small = document.createElement("canvas");
  small.width = 640;
  small.height = 360;
  const ctx = small.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return new Promise((resolve) => small.toBlob((blob) => resolve(blob), "image/jpeg", 0.82));
}

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => ({ ...scene })),
  };
}

function planNeedsReshoot(current: Plan, filmed: Plan | null): boolean {
  if (!filmed) return true;
  if (current.look !== filmed.look || current.title !== filmed.title) return true;
  if (current.scenes.length !== filmed.scenes.length) return true;
  return current.scenes.some((scene, index) => {
    const previous = filmed.scenes[index];
    if (!previous) return true;
    return (
      scene.say !== previous.say ||
      scene.speak !== previous.speak ||
      scene.title !== previous.title ||
      scene.seconds !== previous.seconds
    );
  });
}

function speakChanged(current: Plan, filmed: Plan | null): number[] {
  if (!filmed) return current.scenes.map((_, index) => index);
  return current.scenes
    .map((scene, index) => (scene.speak !== filmed.scenes[index]?.speak ? index : -1))
    .filter((index) => index >= 0);
}

export function ExplainVideo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fontsRef = useRef<FontSet>(FALLBACK_FONTS);
  const topicRef = useRef("");
  const phaseRef = useRef<Phase>("prompt");
  const runRef = useRef(0);
  const engineRef = useRef<FilmEngine | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const shotRef = useRef({ percent: -1 });
  const finishedRef = useRef<Finished | null>(null);
  const codesRef = useRef<(string | null)[]>([]);
  const clipsRef = useRef<(AudioBuffer | null)[] | null>(null);
  const filmedPlanRef = useRef<Plan | null>(null);
  const qualityRef = useRef<Quality>({ fps: 24, width: 1920 });
  const { accessToken } = useAuth();

  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<Phase>("prompt");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [progress, setProgress] = useState(0);
  const [director, setDirector] = useState<DirectorStatus | null>(null);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("explanation.mp4");
  const [selected, setSelected] = useState(0);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [shareUrl, setShareUrl] = useState("");
  const [updateKind, setUpdateKind] = useState<UpdateKind>("idle");

  useEffect(() => {
    topicRef.current = topic;
    phaseRef.current = phase;
    videoUrlRef.current = videoUrl;
  }, [topic, phase, videoUrl]);

  useEffect(() => {
    document.documentElement.classList.add("video-explainer-page");
    return () => {
      document.documentElement.classList.remove("video-explainer-page");
    };
  }, []);

  useEffect(() => {
    fontsRef.current = readFonts();
    void ensureFonts(fontsRef.current).then(() => {
      fontsRef.current = readFonts();
    });
  }, []);

  useEffect(() => {
    return () => {
      runRef.current += 1;
      engineRef.current?.dispose();
      engineRef.current = null;
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const holding = phase === "prompt" || phase === "planning";
    const planning = (phase === "outline" || phase === "writing" || phase === "checking") && plan;
    if (!holding && !planning) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !ctx) return;
    canvas.width = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const time = reduce ? 3 : (now - started) / 1000;
      if (holding) {
        paintHold(ctx, fontsRef.current, time, {
          writing: phaseRef.current === "planning",
          topic: topicRef.current,
        });
      } else if (plan) {
        paintPlan(
          ctx,
          fontsRef.current,
          plan,
          time,
          phase === "writing" || phase === "outline" ? "writing" : "checking",
        );
      }
      if (!reduce) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [phase, plan]);

  function replaceVideo(next: string | null) {
    setVideoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return next;
    });
  }

  function disposeEngine() {
    engineRef.current?.dispose();
    engineRef.current = null;
  }

  function clearFilm() {
    shotRef.current = { percent: -1 };
    finishedRef.current = null;
    codesRef.current = [];
    clipsRef.current = null;
    filmedPlanRef.current = null;
    setShareState("idle");
    setShareUrl("");
    setUpdateKind("idle");
    setProgress(0);
    setDirector(null);
    setError("");
    replaceVideo(null);
  }

  async function planOutline() {
    const cleaned = topic.trim();
    if (!cleaned || phase === "planning" || DRAWING.includes(phase)) return;
    if (cleaned.length > TOPIC_MAX) {
      setError(`Enter a topic or paste text (up to ${TOPIC_MAX.toLocaleString()} characters).`);
      return;
    }

    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    disposeEngine();
    clearFilm();
    setPlan(null);
    setSelected(0);
    setPhase("planning");

    try {
      const planned = planSchema.safeParse(
        await postJson("/api/explain-video", { topic: cleaned }, WRITE_FAILED),
      );
      if (!alive()) return;
      if (!planned.success) throw new Error("The outline came back incomplete. Try a clearer topic.");
      await ensureFonts(fontsRef.current);
      if (!alive()) return;
      setPlan(planned.data);
      setPhase("outline");
    } catch (cause) {
      if (!alive()) return;
      setPhase("prompt");
      setPlan(null);
      const message = cause instanceof Error && cause.message ? cause.message : WRITE_FAILED;
      setError(/^(The film |The outline |Enter a topic|Our app is facing)/.test(message) ? message : WRITE_FAILED);
    }
  }

  async function shootFrom(
    run: number,
    cleaned: string,
    film: Plan,
    codes: (string | null)[],
    serverErrors: (string | undefined)[],
    narration: Narration,
    recheck: boolean,
  ): Promise<void> {
    const alive = () => run === runRef.current;
    const timed = narration.ok
      ? retimeToVoice(film, narration.clips.map((clip) => clip?.duration ?? null))
      : film;
    setPlan(timed);
    setPhase("checking");

    let fps = qualityRef.current.fps;
    let width = qualityRef.current.width;
    let directedCodes = codes;

    if (recheck) {
      const directed = await directFilm({
        topic: cleaned,
        plan: timed,
        codes,
        serverErrors,
        onStatus: (status) => {
          if (alive()) setDirector(status);
        },
        isCancelled: () => !alive(),
      });
      if (!directed) return;
      if (!alive()) {
        directed.engine.dispose();
        return;
      }
      if (directed.fallbacks.length === timed.scenes.length) {
        directed.engine.dispose();
        throw new Error(DRAW_FAILED);
      }
      engineRef.current?.dispose();
      engineRef.current = directed.engine;
      directedCodes = directed.codes;
      codesRef.current = directed.codes;
      fps = directed.fps;
      width = directed.width;
      qualityRef.current = { fps, width };
      if (directed.fallbacks.length) {
        console.warn("[explain-video]", `${listScenes(directed.fallbacks)} fell back to the title card.`);
      }
    } else {
      const engine = await FilmEngine.create(directedCodes, filmEngineConfig(timed, fps, width));
      if (!alive()) {
        engine.dispose();
        return;
      }
      engineRef.current?.dispose();
      engineRef.current = engine;
    }

    const engine = engineRef.current;
    if (!engine) throw new Error(DRAW_FAILED);
    const audio = narration.ok ? await mixNarration(timed, narration.clips).catch(() => null) : null;
    if (!alive()) return;
    const canvas = canvasRef.current;
    if (!canvas) throw new Error(DRAW_FAILED);
    setPhase("filming");
    const poster: { shot: Promise<Blob | null> | null } = { shot: null };
    const shot = await shootFilm({
      engine,
      canvas,
      fps,
      audio,
      isCancelled: () => !alive(),
      onFrame: ({ frame, frames }) => {
        if (!alive()) return;
        if (!poster.shot && frame >= Math.floor(frames * 0.35)) {
          poster.shot = capturePoster(canvas).catch(() => null);
        }
        const percent = Math.floor((frame / Math.max(1, frames - 1)) * 100);
        if (percent !== shotRef.current.percent) {
          shotRef.current.percent = percent;
          setProgress(percent / 100);
        }
      },
    });
    engine.dispose();
    if (engineRef.current === engine) engineRef.current = null;
    if (!alive()) return;
    if (!shot) throw new Error("The film played, but this browser did not save a video file.");

    finishedRef.current = {
      blob: shot.blob,
      plan: timed,
      topic: cleaned,
      durationMs: Math.round(timed.scenes.reduce((sum, scene) => sum + scene.seconds, 0) * 1000),
      poster: poster.shot ? await poster.shot : null,
    };
    filmedPlanRef.current = clonePlan(timed);
    clipsRef.current = narration.ok ? narration.clips : null;
    if (!alive()) return;
    replaceVideo(URL.createObjectURL(shot.blob));
    setDownloadName(`${fileSlug(timed.title)}.${shot.blob.type.includes("mp4") ? "mp4" : "webm"}`);
    setShareState("idle");
    setShareUrl("");
    const voiceGap = narrationGap(narration, Boolean(audio) && shot.voiced, timed.scenes.length);
    if (voiceGap) console.warn("[explain-video]", voiceGap);
    setPhase("studio");
  }

  async function generateFilm() {
    const cleaned = topic.trim();
    const film = plan;
    if (!cleaned || !film || !outlineReady(film) || DRAWING.includes(phase)) return;

    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    disposeEngine();
    shotRef.current = { percent: -1 };
    finishedRef.current = null;
    setShareState("idle");
    setShareUrl("");
    setError("");
    setProgress(0);
    setDirector(null);
    replaceVideo(null);
    setPhase("writing");

    try {
      const recording = recordNarration(film.scenes.map((scene) => scene.speak)).catch(
        (): Narration => ({ ok: false, reason: "failed" }),
      );
      const drawn = sceneCodeResponseSchema.safeParse(
        await postJson("/api/explain-video/scenes", { topic: cleaned, plan: film }, DRAW_FAILED),
      );
      if (!alive()) return;
      if (!drawn.success || drawn.data.scenes.length !== film.scenes.length) throw new Error(DRAW_FAILED);
      const narration = await recording;
      if (!alive()) return;
      codesRef.current = drawn.data.scenes.map((scene) => scene.code);
      await shootFrom(
        run,
        cleaned,
        film,
        codesRef.current,
        drawn.data.scenes.map((scene) => scene.error),
        narration,
        true,
      );
    } catch (cause) {
      if (!alive()) return;
      engineRef.current?.dispose();
      engineRef.current = null;
      setPhase("outline");
      const message = cause instanceof Error && cause.message ? cause.message : DRAW_FAILED;
      setError(/^(The film |This browser |Enter a topic|Our app is facing)/.test(message) ? message : DRAW_FAILED);
    }
  }

  async function redrawScene(index: number) {
    const cleaned = topic.trim();
    const film = plan;
    if (!cleaned || !film || updateKind !== "idle" || DRAWING.includes(phase)) return;
    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    setUpdateKind("redraw");
    setError("");
    setPhase("writing");
    try {
      const drawn = sceneCodeResponseSchema.safeParse(
        await postJson(
          "/api/explain-video/scenes",
          { topic: cleaned, plan: film, indexes: [index] },
          DRAW_FAILED,
        ),
      );
      if (!alive()) return;
      const nextCode = drawn.success ? drawn.data.scenes[index]?.code ?? null : null;
      if (!nextCode) throw new Error("That scene could not be redrawn. Try a simpler picture.");
      const nextCodes = codesRef.current.slice();
      if (nextCodes.length !== film.scenes.length) {
        nextCodes.length = film.scenes.length;
      }
      nextCodes[index] = nextCode;
      codesRef.current = nextCodes;
      const clips = clipsRef.current;
      const narration: Narration = clips
        ? { ok: true, clips }
        : await recordNarration(film.scenes.map((scene) => scene.speak)).catch(
            (): Narration => ({ ok: false, reason: "failed" }),
          );
      if (!alive()) return;
      await shootFrom(run, cleaned, film, nextCodes, [], narration, true);
    } catch (cause) {
      if (!alive()) return;
      setPhase(filmedPlanRef.current ? "studio" : "outline");
      const message = cause instanceof Error && cause.message ? cause.message : DRAW_FAILED;
      setError(message);
    } finally {
      if (alive()) setUpdateKind("idle");
    }
  }

  async function updateFilm() {
    const cleaned = topic.trim();
    const film = plan;
    const filmed = filmedPlanRef.current;
    if (!cleaned || !film || !filmed || updateKind !== "idle" || DRAWING.includes(phase)) return;
    if (!planNeedsReshoot(film, filmed)) return;
    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    setUpdateKind("film");
    setError("");
    try {
      let clips = clipsRef.current;
      const changed = speakChanged(film, filmed);
      if (changed.length) {
        const voiced = await recordNarration(changed.map((index) => film.scenes[index]!.speak));
        if (!alive()) return;
        if (voiced.ok) {
          const next = (clips ?? film.scenes.map(() => null)).slice();
          changed.forEach((index, order) => {
            next[index] = voiced.clips[order] ?? null;
          });
          clips = next;
          clipsRef.current = next;
        }
      }
      const narration: Narration = clips ? { ok: true, clips } : { ok: false, reason: "failed" };
      await shootFrom(run, cleaned, film, codesRef.current, [], narration, false);
    } catch (cause) {
      if (!alive()) return;
      setPhase("studio");
      const message = cause instanceof Error && cause.message ? cause.message : DRAW_FAILED;
      setError(message);
    } finally {
      if (alive()) setUpdateKind("idle");
    }
  }

  async function shareFilm() {
    const film = finishedRef.current;
    if (!film || shareState === "sharing" || shareState === "copied") return;
    setShareState("sharing");
    try {
      const form = new FormData();
      const ext = film.blob.type.includes("mp4") ? "mp4" : "webm";
      form.set("video", film.blob, `explanation.${ext}`);
      if (film.poster) form.set("poster", film.poster, "poster.jpg");
      form.set("title", film.plan.title);
      form.set("topic", film.topic);
      form.set("plan", JSON.stringify(film.plan));
      form.set("durationMs", String(film.durationMs));
      const headers: HeadersInit = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetch("/api/explain-video/share", { method: "POST", headers, body: form });
      const payload = (await response.json().catch(() => null)) as { path?: string; error?: string } | null;
      if (!response.ok || !payload?.path) {
        throw new Error(payload?.error || "Could not create a share link.");
      }
      const url = new URL(payload.path, window.location.origin).toString();
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // The link is still shown in the studio status line.
      }
      setShareState("copied");
    } catch (cause) {
      console.warn("[explain-video] share failed", cause);
      setShareState("failed");
      setError(cause instanceof Error && cause.message ? cause.message : "Could not create a share link.");
    }
  }

  const drawing = DRAWING.includes(phase);
  const canUpdate = Boolean(plan && filmedPlanRef.current && planNeedsReshoot(plan, filmedPlanRef.current));
  const status =
    error ||
    (phase === "planning"
      ? "Planning a five-scene outline"
      : phase === "writing"
        ? "Drawing the scenes and recording the narration"
        : phase === "checking"
          ? director?.kind === "repairing"
            ? `Redrawing ${director.count === 1 ? "one scene" : `${director.count} scenes`}`
            : `Checking scene ${(director?.kind === "checking" ? director.index : 0) + 1} of ${plan?.scenes.length ?? 0}`
          : phase === "filming"
            ? `Filming ${Math.round(progress * 100)}%`
            : phase === "studio" && plan
              ? "Edit a scene, then update the film — or share the link."
              : phase === "outline"
                ? "Review the five scenes, then generate visuals and narration."
                : "Type an idea. Get a visual explanation worth sharing.");

  const showStage = phase !== "prompt" && phase !== "planning";
  const showVideo = Boolean(videoUrl && phase === "studio" && updateKind === "idle");
  const aside =
    phase === "studio" || updateKind !== "idle"
      ? "studio"
      : phase === "outline" || drawing
        ? "outline"
        : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f4f4f6] font-[family-name:var(--font-geist)] text-[#16161a]">
      <header className="flex shrink-0 items-start justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <BrandMark compact size="sm" className="[&>span]:text-[#16161a]" />
          <span className="inline-flex h-9 items-center rounded-lg bg-[#16161a] px-3 text-[13px] font-medium text-white">
            Video explainer
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild type="button" variant="outline" size="sm" className={cn("gap-1.5", INSPECT_CHIP_ICON)}>
            <Link href={DASHBOARD_TAB}>
              <LayoutGrid className="size-3.5" />
              Dashboard
            </Link>
          </Button>
          <StudyMenu
            current="explain-video"
            className="h-9 rounded-lg border border-[#ececee] bg-white px-3 text-[13px] font-medium text-[#16161a] hover:bg-[#fafafa] [&>span]:text-[#16161a]"
          />
        </div>
      </header>

      <div className={cn("flex min-h-0 flex-1 flex-col", aside && "lg:flex-row")}>
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col items-center justify-center px-4",
            phase === "prompt" ? "pb-10" : "pb-4",
          )}
        >
          {phase === "prompt" || phase === "planning" ? (
            <PromptComposer
              topic={topic}
              onTopic={(value) => {
                setTopic(value);
                if (error) setError("");
              }}
              onSubmit={() => void planOutline()}
              busy={phase === "planning"}
              error={error}
            />
          ) : null}

          {showStage ? (
            <div className="w-full max-w-[min(100%,calc((100dvh-8rem)*16/9))] overflow-hidden rounded-lg border border-[#ececee] bg-white">
              <div className="relative aspect-video w-full bg-[#16161a]">
                <canvas
                  ref={canvasRef}
                  className={showVideo ? "hidden" : "h-full w-full"}
                  aria-hidden={showVideo ? true : undefined}
                />
                {showVideo ? (
                  <video
                    key={videoUrl}
                    src={videoUrl ?? undefined}
                    className="h-full w-full bg-[#16161a]"
                    controls
                    autoPlay
                    playsInline
                    aria-label={plan?.title ?? "Explanation video"}
                  />
                ) : null}
              </div>
              {phase === "filming" ? (
                <div className="h-1 bg-[#ececee]" aria-hidden>
                  <div
                    className="h-full bg-[#16161a] transition-[width] duration-200"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <canvas ref={canvasRef} className="hidden" aria-hidden />
          )}
        </main>

        {aside && plan ? (
          <aside className="h-[min(46dvh,28rem)] shrink-0 border-t border-[#ececee] bg-white lg:h-auto lg:w-[26rem] lg:border-t-0 lg:border-l xl:w-[28rem]">
            {aside === "studio" ? (
              <SceneStudio
                plan={plan}
                selected={Math.min(selected, plan.scenes.length - 1)}
                onSelect={setSelected}
                onPlan={setPlan}
                onRedraw={(index) => void redrawScene(index)}
                onUpdateFilm={() => void updateFilm()}
                onShare={() => void shareFilm()}
                onNew={() => {
                  runRef.current += 1;
                  disposeEngine();
                  clearFilm();
                  setPlan(null);
                  setPhase("prompt");
                }}
                videoUrl={videoUrl}
                downloadName={downloadName}
                shareState={shareState}
                shareUrl={shareUrl}
                updateKind={updateKind}
                canUpdate={canUpdate}
                error={error}
                status={status}
              />
            ) : (
              <OutlineReview
                plan={plan}
                onPlan={setPlan}
                onBack={() => {
                  if (drawing) return;
                  setPhase("prompt");
                  setError("");
                }}
                onGenerate={() => void generateFilm()}
                busy={drawing}
                error={error}
              />
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
