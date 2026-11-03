"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Monitor,
  RotateCcw,
  Smartphone,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { BrandMark } from "@/components/lms/BrandMark";
import { StudyMenu } from "@/components/modes/ModeNav";
import { Button } from "@/components/ui/button";
import {
  KOKORO_VOICES,
  WORDS_PER_SECOND,
  DEMO_KINDS,
  wordCount,
  type ExplainerJob,
  type ExplainerPoint,
  type ExplainerScript,
  type Orientation,
  type VoiceId,
} from "@/lib/explainer-video/types";
import { INSPECT_CHIP } from "@/lib/smart-tutor/chrome";
import { cn } from "@/lib/utils";

type Step = "brief" | "script" | "voice" | "build";

const STAGES: Array<{ stage: ExplainerJob["stage"]; label: string }> = [
  { stage: "voice", label: "Recording the voice" },
  { stage: "timing", label: "Timing every word" },
  { stage: "building", label: "Building scenes" },
  { stage: "checking", label: "Checking the composition" },
  { stage: "snapshots", label: "Taking review snapshots" },
  { stage: "preview", label: "Review" },
  { stage: "rendering", label: "Rendering frames" },
  { stage: "mixing", label: "Mixing to -15 LUFS" },
  { stage: "done", label: "Done" },
];

const FIELD =
  "w-full rounded-lg border border-[#ececee] bg-white px-3 py-2 text-[14px] text-[#16161a] outline-none placeholder:text-[#a1a1aa] focus:border-[#16161a]/40";
const LABEL = "mb-1 block text-[12px] font-medium text-[#71717a]";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

const fileUrl = (job: ExplainerJob, name: string) => `/api/explainer-videos/jobs/${job.id}/files/${name}`;

export function ExplainerVideosWorkspace() {
  const [step, setStep] = useState<Step>("brief");
  const [topic, setTopic] = useState("");
  const [mustMention, setMustMention] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("vertical");
  const [script, setScript] = useState<ExplainerScript | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [voice, setVoice] = useState<VoiceId | null>(null);
  const [samples, setSamples] = useState<Array<{ voice: VoiceId; url: string }> | null>(null);
  const [job, setJob] = useState<ExplainerJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [worker, setWorker] = useState<{ ready: boolean; missing: string[] } | null>(null);
  const samplesFor = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/explainer-videos/status")
      .then((r) => r.json())
      .then(setWorker)
      .catch(() => setWorker({ ready: false, missing: ["the local worker"] }));
  }, []);

  // Poll the job while it's working.
  useEffect(() => {
    if (!job || ["preview", "done", "error"].includes(job.stage)) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/explainer-videos/jobs/${job.id}`);
      if (!response.ok) return;
      const { job: next } = (await response.json()) as { job: ExplainerJob };
      setJob(next);
    }, 1500);
    return () => clearInterval(timer);
  }, [job]);

  async function writeScript() {
    setError(null);
    setBusy("Writing the script…");
    try {
      const { script: next, warnings: notes } = await postJson<{ script: ExplainerScript; warnings: string[] }>(
        "/api/explainer-videos/script",
        { topic, mustMention },
      );
      setScript(next);
      setWarnings(notes);
      setStep("script");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const loadSamples = useCallback(async (line: string) => {
    if (samplesFor.current === line) return;
    samplesFor.current = line;
    setSamples(null);
    setError(null);
    setBusy("Reading line 1 in three voices…");
    try {
      const { samples: next } = await postJson<{ samples: Array<{ voice: VoiceId; url: string }> }>(
        "/api/explainer-videos/voices",
        { text: line },
      );
      setSamples(next);
    } catch (err) {
      samplesFor.current = null;
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  async function buildPreview() {
    if (!script || !voice) return;
    setError(null);
    setBusy("Starting…");
    try {
      const { job: next } = await postJson<{ job: ExplainerJob }>("/api/explainer-videos/jobs", {
        script,
        voice,
        orientation,
      });
      setJob(next);
      setStep("build");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function render() {
    if (!job) return;
    setError(null);
    try {
      const { job: next } = await postJson<{ job: ExplainerJob }>(`/api/explainer-videos/jobs/${job.id}/render`, {});
      setJob(next);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startOver() {
    setStep("brief");
    setScript(null);
    setJob(null);
    setSamples(null);
    setVoice(null);
    samplesFor.current = null;
    setError(null);
  }

  return (
    <div className="min-h-screen bg-[#f4f4f6] font-[family-name:var(--font-geist)] text-[#16161a]">
      <header className="flex items-center justify-between gap-3 p-3">
        <BrandMark compact size="sm" className="[&>span]:text-[#16161a]" />
        <StudyMenu
          current="explainer-videos"
          className="h-9 rounded-lg border border-[#ececee] bg-white px-3 text-[13px] font-medium text-[#16161a] hover:bg-[#fafafa] [&>span]:text-[#16161a]"
        />
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
        <h1 className="text-[1.75rem] font-medium tracking-[-0.02em]">Explainer videos</h1>
        <p className="mt-1 text-[14px] text-[#71717a]">
          A 30-60 second narrated reel with captions and a talking presenter. You approve the script,
          pick a voice, check the frames, then render.
        </p>

        <Steps step={step} />

        {worker && !worker.ready ? (
          <div className="mt-4 rounded-lg border border-[#ececee] bg-white p-4 text-[13px]">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4 text-[#c24545]" aria-hidden />
              Videos render on the computer running this app, and it&apos;s missing: {worker.missing.join(", ")}.
            </p>
            <p className="mt-2 text-[#71717a]">
              Run <code className="rounded bg-[#f4f4f6] px-1.5 py-0.5">video-worker/setup.sh</code> once, then reload.
              You can still write and edit a script.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg border border-[#ececee] bg-white px-3 py-2 text-[13px] text-[#c24545]" role="alert">
            {error}
          </p>
        ) : null}

        {step === "brief" ? (
          <section className="mt-6 space-y-4">
            <div>
              <label className={LABEL} htmlFor="ev-topic">Topic</label>
              <input
                id="ev-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. How spaced repetition works"
                className={FIELD}
                maxLength={200}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="ev-must">Anything it must mention (optional)</label>
              <textarea
                id="ev-must"
                value={mustMention}
                onChange={(e) => setMustMention(e.target.value)}
                placeholder="Facts, terms, or examples to include"
                rows={3}
                className={FIELD}
                maxLength={500}
              />
            </div>
            <OrientationPicker value={orientation} onChange={setOrientation} />
            <Button
              type="button"
              disabled={topic.trim().length < 2 || Boolean(busy)}
              onClick={() => void writeScript()}
              className="h-10 gap-2 rounded-lg bg-[#16161a] px-4 text-[14px] text-white hover:bg-[#2a2a2e]"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {busy ?? "Write the script"}
            </Button>
          </section>
        ) : null}

        {step === "script" && script ? (
          <ScriptEditor
            script={script}
            warnings={warnings}
            onChange={setScript}
            busy={busy}
            onBack={() => setStep("brief")}
            onRewrite={() => void writeScript()}
            onNext={() => {
              setStep("voice");
              void loadSamples(script.hook[0]);
            }}
          />
        ) : null}

        {step === "voice" && script ? (
          <section className="mt-6">
            <p className="text-[14px] text-[#3f3f46]">
              Line 1 — <span className="italic">“{script.hook[0]}”</span> — in three voices. Pick one.
            </p>
            {busy && !samples ? (
              <p className="mt-6 flex items-center gap-2 text-[14px] text-[#5b4fd4]" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {busy}
              </p>
            ) : null}
            {samples ? (
              <div className="mt-4 grid gap-3">
                {samples.map((sample) => {
                  const meta = KOKORO_VOICES.find((v) => v.id === sample.voice)!;
                  const chosen = voice === sample.voice;
                  return (
                    <div
                      key={sample.voice}
                      className={cn(
                        "flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3",
                        chosen ? "border-[#16161a]" : "border-[#ececee]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setVoice(sample.voice)}
                        aria-pressed={chosen}
                        className={cn(
                          "flex h-9 min-w-36 items-center gap-2 rounded-lg px-3 text-left text-[13px] font-medium",
                          chosen ? "bg-[#16161a] text-white" : "bg-[#f4f4f6] text-[#16161a] hover:bg-[#ececee]",
                        )}
                      >
                        {chosen ? <Check className="size-4" /> : null}
                        {meta.label}
                        <span className={cn("font-normal", chosen ? "text-white/70" : "text-[#71717a]")}>{meta.note}</span>
                      </button>
                      <audio controls src={sample.url} className="h-9 min-w-0 flex-1" preload="auto" />
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" variant="outline" className={cn("gap-1.5", INSPECT_CHIP)} onClick={() => setStep("script")}>
                <ArrowLeft className="size-3.5" />
                Script
              </Button>
              {!samples && !busy ? (
                <Button type="button" variant="outline" className={cn("gap-1.5", INSPECT_CHIP)} onClick={() => void loadSamples(script.hook[0])}>
                  <RotateCcw className="size-3.5" />
                  Try again
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={!voice || Boolean(busy)}
                onClick={() => void buildPreview()}
                className="h-9 gap-2 rounded-lg bg-[#16161a] px-4 text-[13px] text-white hover:bg-[#2a2a2e]"
              >
                {busy && samples ? <Loader2 className="size-4 animate-spin" /> : null}
                Record and build preview
              </Button>
            </div>
          </section>
        ) : null}

        {step === "build" && job ? (
          <BuildPanel job={job} onRender={() => void render()} onBack={() => setStep("voice")} onStartOver={startOver} />
        ) : null}
      </main>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: "brief", label: "Topic" },
    { id: "script", label: "Script" },
    { id: "voice", label: "Voice" },
    { id: "build", label: "Preview and render" },
  ];
  const at = steps.findIndex((s) => s.id === step);
  return (
    <ol className="mt-5 flex flex-wrap gap-2 text-[12px]">
      {steps.map((s, i) => (
        <li
          key={s.id}
          className={cn(
            "rounded-full border px-2.5 py-1",
            i === at ? "border-[#16161a] bg-[#16161a] text-white" : i < at ? "border-[#ececee] bg-white text-[#16161a]" : "border-[#ececee] text-[#a1a1aa]",
          )}
        >
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}

function OrientationPicker({ value, onChange }: { value: Orientation; onChange: (o: Orientation) => void }) {
  const options: Array<{ id: Orientation; label: string; hint: string; icon: typeof Smartphone }> = [
    { id: "vertical", label: "Vertical", hint: "1080×1920 · Reels, Shorts, TikTok", icon: Smartphone },
    { id: "horizontal", label: "Horizontal", hint: "1920×1080 · YouTube, slides", icon: Monitor },
  ];
  return (
    <div>
      <span className={LABEL}>Shape</span>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Video shape">
        {options.map((o) => {
          const Icon = o.icon;
          const chosen = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => onChange(o.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-white p-3 text-left transition",
                chosen ? "border-[#16161a]" : "border-[#ececee] hover:border-[#16161a]/30",
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span>
                <span className="block text-[14px] font-medium">{o.label}</span>
                <span className="block text-[12px] text-[#71717a]">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScriptEditor({
  script,
  warnings,
  onChange,
  busy,
  onBack,
  onRewrite,
  onNext,
}: {
  script: ExplainerScript;
  warnings: string[];
  onChange: (s: ExplainerScript) => void;
  busy: string | null;
  onBack: () => void;
  onRewrite: () => void;
  onNext: () => void;
}) {
  const words = wordCount(script);
  const seconds = Math.round(words / WORDS_PER_SECOND);
  const setPoint = (i: number, patch: Partial<ExplainerPoint>) =>
    onChange({ ...script, points: script.points.map((p, k) => (k === i ? { ...p, ...patch } : p)) });

  return (
    <section className="mt-6 space-y-5">
      <p className={cn("text-[13px]", seconds < 30 || seconds > 60 ? "text-[#c24545]" : "text-[#71717a]")}>
        {words} spoken words · about {seconds} s{seconds < 30 || seconds > 60 ? " (aim for 30-60 s)" : ""}
      </p>
      {warnings.length ? (
        <ul className="list-disc space-y-1 rounded-lg border border-[#ececee] bg-white py-2 pr-3 pl-7 text-[12px] text-[#71717a]">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <Block title="Hook">
        <Text label="Line 1 — the problem, under 6 words" value={script.hook[0]} onChange={(v) => onChange({ ...script, hook: [v, script.hook[1]] })} />
        <Text label="Line 2 — the payoff" value={script.hook[1]} onChange={(v) => onChange({ ...script, hook: [script.hook[0], v] })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="Problem card (gets struck through)" value={script.problem} onChange={(v) => onChange({ ...script, problem: v })} />
          <Text
            label="Payoff cards (comma separated)"
            value={script.payoff.join(", ")}
            onChange={(v) => onChange({ ...script, payoff: v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3) })}
          />
        </div>
      </Block>

      {script.points.map((p, i) => (
        <Block key={i} title={`Point ${i + 1}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Text label="Title word 1 (ink)" value={p.title[0]} onChange={(v) => setPoint(i, { title: [v, p.title[1]] })} />
            <Text label="Title word 2 (red)" value={p.title[1]} onChange={(v) => setPoint(i, { title: [p.title[0], v] })} />
          </div>
          <Text label="Spoken line (says both title words)" value={p.line} onChange={(v) => setPoint(i, { line: v })} multiline />
          <Text label="Spoken explanation (the demo acts this out)" value={p.explanation} onChange={(v) => setPoint(i, { explanation: v })} multiline />
          <details className="rounded-lg border border-[#ececee] bg-[#fafafa] px-3 py-2">
            <summary className="cursor-pointer text-[12px] font-medium text-[#71717a]">On-screen details</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Text label="Header label" value={p.name} onChange={(v) => setPoint(i, { name: v })} />
              <Text label="Stamp" value={p.stamp} onChange={(v) => setPoint(i, { stamp: v })} />
              <Text label="Stamp lands on (word in explanation)" value={p.stampWord} onChange={(v) => setPoint(i, { stampWord: v })} />
              <Text
                label="Stat number"
                value={String(p.stat.value)}
                onChange={(v) => setPoint(i, { stat: { ...p.stat, value: Math.max(1, Math.min(9999, Number(v.replace(/\D/g, "")) || 1)) } })}
              />
              <Text label="Stat suffix (%, x, s…)" value={p.stat.suffix} onChange={(v) => setPoint(i, { stat: { ...p.stat, suffix: v.slice(0, 3) } })} />
              <Text label="Stat label" value={p.stat.label} onChange={(v) => setPoint(i, { stat: { ...p.stat, label: v } })} />
              <Text label="Card caption" value={p.card} onChange={(v) => setPoint(i, { card: v })} />
              <Text label="Typed line" value={p.typed} onChange={(v) => setPoint(i, { typed: v })} />
              <label className="block">
                <span className={LABEL}>Typed into</span>
                <select className={FIELD} value={p.bar} onChange={(e) => setPoint(i, { bar: e.target.value as ExplainerPoint["bar"] })}>
                  <option value="terminal">Terminal</option>
                  <option value="search">Search bar</option>
                </select>
              </label>
              <label className="block">
                <span className={LABEL}>Demo</span>
                <select
                  className={FIELD}
                  value={p.demo.kind}
                  onChange={(e) => setPoint(i, { demo: { ...p.demo, kind: e.target.value as ExplainerPoint["demo"]["kind"] } })}
                >
                  {DEMO_KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
              <div className="sm:col-span-2">
                <Text
                  label="Demo items (comma separated, 2-4)"
                  value={p.demo.items.join(", ")}
                  onChange={(v) => setPoint(i, { demo: { ...p.demo, items: v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4) } })}
                />
              </div>
            </div>
          </details>
        </Block>
      ))}

      <Block title="Closing">
        <Text label="Pays off the hook" value={script.closing} onChange={(v) => onChange({ ...script, closing: v })} multiline />
      </Block>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className={cn("gap-1.5", INSPECT_CHIP)} onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          Topic
        </Button>
        <Button type="button" variant="outline" disabled={Boolean(busy)} className={cn("gap-1.5", INSPECT_CHIP)} onClick={onRewrite}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          {busy ?? "Rewrite"}
        </Button>
        <Button type="button" disabled={Boolean(busy)} onClick={onNext} className="h-9 rounded-lg bg-[#16161a] px-4 text-[13px] text-white hover:bg-[#2a2a2e]">
          Script looks good — pick a voice
        </Button>
      </div>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-[#ececee] bg-white p-4">
      <legend className="px-1 text-[13px] font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

function Text({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {multiline ? (
        <textarea className={FIELD} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={FIELD} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function BuildPanel({
  job,
  onRender,
  onBack,
  onStartOver,
}: {
  job: ExplainerJob;
  onRender: () => void;
  onBack: () => void;
  onStartOver: () => void;
}) {
  const at = STAGES.findIndex((s) => s.stage === job.stage);
  const working = !["preview", "done", "error"].includes(job.stage);
  const vertical = job.orientation === "vertical";
  return (
    <section className="mt-6 space-y-5">
      <ol className="space-y-1.5 rounded-xl border border-[#ececee] bg-white p-4 text-[13px]" aria-live="polite">
        {STAGES.filter((s) => s.stage !== "preview" || at >= 5).map((s) => {
          const i = STAGES.indexOf(s);
          const done = at > i || job.stage === "done";
          const active = s.stage === job.stage && working;
          return (
            <li key={s.stage} className={cn("flex items-center gap-2", done ? "text-[#16161a]" : active ? "text-[#5b4fd4]" : "text-[#a1a1aa]")}>
              {done ? (
                <Check className="size-4" aria-hidden />
              ) : active ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <span className="size-4" aria-hidden />
              )}
              {s.label}
              {s.stage === "voice" && job.duration && done ? (
                <span className="text-[#71717a]">· {job.duration.toFixed(1)} s cut</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {job.stage === "error" ? (
        <div className="rounded-lg border border-[#ececee] bg-white p-3 text-[13px] text-[#c24545]" role="alert">
          {job.error}
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" className={cn("gap-1.5", INSPECT_CHIP)} onClick={onBack}>
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
            {job.snapshots?.length ? (
              <Button type="button" variant="outline" className={cn("gap-1.5", INSPECT_CHIP)} onClick={onRender}>
                <RotateCcw className="size-3.5" />
                Retry render
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {job.snapshots?.length && job.stage !== "done" ? (
        <div>
          <p className="mb-2 text-[13px] text-[#71717a]">
            Check these frames before rendering{job.duration ? ` · ${job.duration.toFixed(1)} s` : ""}.
          </p>
          <div className={cn("grid gap-3", vertical ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
            {job.snapshots.map((s) => (
              <figure key={s.file} className="overflow-hidden rounded-lg border border-[#ececee] bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element -- local job snapshot */}
                <img src={fileUrl(job, s.file)} alt={s.label} className="block w-full" loading="lazy" />
                <figcaption className="border-t border-[#ececee] px-2 py-1.5 text-[12px] text-[#71717a]">{s.label}</figcaption>
              </figure>
            ))}
          </div>
          {job.stage === "preview" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" className={cn("gap-1.5", INSPECT_CHIP)} onClick={onBack}>
                <ArrowLeft className="size-3.5" />
                Change voice or script
              </Button>
              <Button type="button" onClick={onRender} className="h-9 rounded-lg bg-[#16161a] px-4 text-[13px] text-white hover:bg-[#2a2a2e]">
                Render the video
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {job.stage === "done" && job.video ? (
        <div className="space-y-3">
          <video
            controls
            playsInline
            src={fileUrl(job, job.video)}
            className={cn("block rounded-xl border border-[#ececee] bg-black", vertical ? "mx-auto max-h-[78vh]" : "w-full")}
          />
          <div className="flex flex-wrap gap-2">
            <a
              href={`${fileUrl(job, job.video)}?download`}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#16161a] px-4 text-[13px] font-medium text-white hover:bg-[#2a2a2e]"
            >
              <Download className="size-4" />
              Download MP4
            </a>
            <Button type="button" variant="outline" className={cn("gap-1.5", INSPECT_CHIP)} onClick={onStartOver}>
              Make another
            </Button>
          </div>
          <p className="text-[12px] text-[#71717a]">{job.detail}. Sounds and music are CC0 or royalty-free; see video-worker/assets/CREDITS.md.</p>
        </div>
      ) : null}
    </section>
  );
}
