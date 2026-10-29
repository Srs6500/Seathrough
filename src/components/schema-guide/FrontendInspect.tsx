"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fetchVibeInspect,
  vibeSourcePageUrl,
  type VibeInspectReport,
  type VibeInspectTarget,
} from "@/lib/vibe-coder/client";
import { reuseOnRoute } from "@/lib/vibe-coder/inspectReuse";
import type {
  InspectButtonStyle,
  InspectFontRole,
  InspectNote,
  InspectOverview,
  InspectReuse,
} from "@/lib/vibe-coder/inspectTypes";

type Width = "desktop" | "tablet" | "phone";
type Panel = "what" | "how" | "attention";
type Screen = "overview" | "page";
type Action = "none" | "source" | "states" | "fix";

const WIDTHS: Array<{ id: Width; label: string; px: number }> = [
  { id: "desktop", label: "Desktop", px: 1280 },
  { id: "tablet", label: "Tablet", px: 768 },
  { id: "phone", label: "Phone", px: 390 },
];

function originLabel(value: string): string {
  if (value === "hardcoded") return "Hardcoded";
  if (value === "mock") return "Demo / mock";
  if (value === "user") return "User input";
  if (value === "api") return "API / session";
  return "Unknown";
}

function actionLabel(value: string): string {
  if (value === "navigate") return "Navigation";
  if (value === "state") return "State update";
  if (value === "api") return "API / server action";
  if (value === "submit") return "Form submit";
  return "No behavior";
}

function missingStates(target: VibeInspectTarget): string[] {
  return (
    [
      !target.how.states.loading ? "loading" : null,
      !target.how.states.empty ? "empty" : null,
      !target.how.states.error ? "error" : null,
      !target.how.states.success ? "success" : null,
      !target.how.states.disabled ? "disabled" : null,
    ] as Array<string | null>
  ).filter((value): value is string => Boolean(value));
}

function pageNameOf(report: VibeInspectReport | null, route: string): string {
  return report?.pages.find((page) => page.route === route)?.name ?? route;
}

export function FrontendInspect({ repoName }: { repoName: string }) {
  const [report, setReport] = useState<VibeInspectReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [route, setRoute] = useState("/");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [width, setWidth] = useState<Width>("desktop");
  const [panel, setPanel] = useState<Panel>("what");
  const [screen, setScreen] = useState<Screen>("overview");
  const [action, setAction] = useState<Action>("none");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    setReport(null);
    setSelectedId(null);
    setAction("none");
    void fetchVibeInspect(repoName)
      .then((next) => {
        if (cancelled) return;
        setReport(next);
        setRoute(next.pages[0]?.route ?? "/");
        setBusy(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not read that frontend.");
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoName]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.data?.type !== "seethrough-inspect") return;
      const id = String(event.data.id || "");
      if (!id) return;
      setSelectedId(id);
      setScreen("page");
      setPanel("what");
      setAction("none");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "seethrough-select", id: selectedId },
      "*",
    );
  }, [selectedId, route]);

  const pageTargets = useMemo(
    () => (report?.targets ?? []).filter((target) => target.route === route),
    [report, route],
  );
  const selected =
    pageTargets.find((target) => target.id === selectedId) ?? null;
  const pageNotes = useMemo(() => {
    const notes = pageTargets.flatMap((target) =>
      target.attention.map((note) => ({ note, target })),
    );
    const seen = new Set<string>();
    return notes.filter((item) => {
      const key = `${item.note.area}:${item.note.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [pageTargets]);
  const currentPage = report?.pages.find((page) => page.route === route) ?? null;
  const frameWidth = WIDTHS.find((item) => item.id === width)?.px ?? 1280;

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () =>
      setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [busy, error, report]);

  const frameScale =
    canvasSize.width > 48 ? Math.min(1, (canvasSize.width - 32) / frameWidth) : 1;

  function openOverview() {
    setScreen("overview");
    setSelectedId(null);
    setAction("none");
  }

  function openPage(nextRoute: string) {
    setScreen("page");
    setRoute(nextRoute);
    setSelectedId(null);
    setAction("none");
    setPanel("what");
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f4f4f6]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#ececee] bg-white px-3">
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={openOverview}
              className={`shrink-0 rounded-full px-3 py-1 text-[13px] ${
                screen === "overview"
                  ? "bg-[#f4f1ff] text-[#5b4fd4]"
                  : "text-[#71717a] hover:bg-[#fafafa]"
              }`}
            >
              Overview
            </button>
            {(report?.pages ?? []).map((page) => (
              <button
                key={page.route}
                type="button"
                onClick={() => openPage(page.route)}
                className={`shrink-0 rounded-full px-3 py-1 text-[13px] ${
                  screen === "page" && route === page.route
                    ? "bg-[#f4f1ff] text-[#5b4fd4]"
                    : "text-[#71717a] hover:bg-[#fafafa]"
                }`}
              >
                {page.name}
              </button>
            ))}
          </nav>
          {screen === "page" ? (
            <div className="flex shrink-0 items-center gap-1">
              {WIDTHS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setWidth(item.id)}
                  className={`rounded-full px-2.5 py-1 text-[12px] ${
                    width === item.id
                      ? "bg-[#16161a] text-white"
                      : "text-[#71717a] hover:bg-[#fafafa]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div
          ref={canvasRef}
          className="relative min-h-0 flex-1 overflow-hidden bg-[#ececee] p-4"
        >
          {busy ? (
            <EmptyFrame
              title="Reading the frontend"
              body="Mapping components, actions, and what still needs attention."
            />
          ) : error ? (
            <EmptyFrame title="Could not read this frontend" body={error} />
          ) : screen === "overview" ? (
            <div className="h-full overflow-auto rounded-lg border border-[#ddd] bg-white p-6">
              <OverviewPanel overview={report?.overview ?? null} />
            </div>
          ) : !report?.pages.length ? (
            <EmptyFrame
              title="No pages to inspect"
              body="This repository has no app pages we can render from source."
            />
          ) : (
            <div
              className="mx-auto h-full overflow-hidden rounded-lg border border-[#ddd] bg-white"
              style={{
                width: `${Math.round(frameWidth * frameScale)}px`,
                maxWidth: "100%",
              }}
            >
              <iframe
                ref={frameRef}
                key={`${repoName}:${route}:${frameWidth}`}
                title={currentPage?.name || "Page"}
                src={vibeSourcePageUrl(repoName, route)}
                className="border-0"
                style={{
                  width: `${frameWidth}px`,
                  height: frameScale > 0 ? `${100 / frameScale}%` : "100%",
                  transform: `scale(${frameScale})`,
                  transformOrigin: "top left",
                }}
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          )}
        </div>
      </div>

      {screen === "page" ? (
      <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-l border-[#ececee] bg-white">
        <div className="border-b border-[#ececee] px-4 py-3">
          <p className="text-[13px] text-[#71717a]">
            {selected ? selected.kind : "This screen"}
          </p>
          <p className="mt-0.5 text-[16px] font-medium tracking-[-0.02em] text-[#16161a]">
            {selected?.name || currentPage?.name || "Frontend"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-[#ececee] px-3 py-2">
          {(
            [
              ["what", "What is this?"],
              ["how", "How it works"],
              ["attention", "Needs attention"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={panel === id}
              onClick={() => setPanel(id)}
              className={`rounded-full px-2.5 py-1 text-[12px] ${
                panel === id ? "bg-[#f4f1ff] text-[#5b4fd4]" : "text-[#71717a]"
              }`}
            >
              {label}
              {id === "attention" &&
              (selected ? selected.attention.length : pageNotes.length) > 0
                ? ` ${selected ? selected.attention.length : pageNotes.length}`
                : ""}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {busy ? (
            <p className="text-[15px] leading-relaxed text-[#3f3f46]">
              Reading this frontend from source.
            </p>
          ) : selected ? (
            <TargetPanel
              target={selected}
              panel={panel}
              action={action}
              report={report}
              width={width}
              onOpenPage={openPage}
            />
          ) : (
            <PageBrief
              page={currentPage?.name || "This page"}
              file={currentPage?.file || ""}
              panel={panel}
              targets={pageTargets}
              notes={pageNotes}
              reuse={report?.reuse ?? []}
              report={report}
              route={route}
              width={width}
              onPick={(id) => {
                setSelectedId(id);
                setAction("none");
              }}
              onOpenPage={openPage}
            />
          )}
        </div>
        {selected ? (
          <div className="flex flex-col gap-2 border-t border-[#ececee] p-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAction(action === "source" ? "none" : "source")}
                className={`flex-1 rounded-lg border px-2 py-2 text-[12px] ${
                  action === "source"
                    ? "border-[#16161a] bg-[#16161a] text-white"
                    : "border-[#ececee] text-[#16161a]"
                }`}
              >
                Show source
              </button>
              <button
                type="button"
                onClick={() => setAction(action === "states" ? "none" : "states")}
                className={`flex-1 rounded-lg border px-2 py-2 text-[12px] ${
                  action === "states"
                    ? "border-[#16161a] bg-[#16161a] text-white"
                    : "border-[#ececee] text-[#16161a]"
                }`}
              >
                Preview states
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAction(action === "fix" ? "none" : "fix")}
              className={`rounded-lg px-3 py-2 text-[12px] ${
                action === "fix"
                  ? "bg-[#5b4fd4] text-white"
                  : "bg-[#16161a] text-white"
              }`}
            >
              Prepare a fix
            </button>
          </div>
        ) : (
          <p className="border-t border-[#ececee] px-4 py-3 text-[13px] text-[#71717a]">
            Click anything on the page to find its component, styles, and content source.
          </p>
        )}
      </aside>
      ) : null}
    </div>
  );
}

function EmptyFrame({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <div>
        <p className="text-[18px] font-medium text-[#16161a]">{title}</p>
        <p className="mt-2 max-w-sm text-[14px] text-[#52525b]">{body}</p>
      </div>
    </div>
  );
}

function fontStack(family: string): string {
  if (/mono/i.test(family)) return `"${family}", ui-monospace, monospace`;
  if (/serif|fraunces|playfair|merriweather|georgia/i.test(family)) {
    return `"${family}", Georgia, serif`;
  }
  return `"${family}", ui-sans-serif, system-ui, sans-serif`;
}

function fontWeightValue(weight: string): number {
  if (/extrabold|800/.test(weight)) return 800;
  if (/bold|700/.test(weight)) return 700;
  if (/semibold|600/.test(weight)) return 600;
  if (/medium|500/.test(weight)) return 500;
  return 400;
}

function OverviewPanel({ overview }: { overview: InspectOverview | null }) {
  if (!overview) {
    return (
      <p className="text-[13px] leading-relaxed text-[#3f3f46]">
        No type, color, or button system was found in this frontend yet.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 text-[15px] leading-relaxed text-[#3f3f46]">
      <section>
        <p className="text-[12px] uppercase tracking-[0.06em] text-[#a1a1aa]">Font style</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {overview.fonts.map((font) => (
            <FontRow key={font.role} font={font} />
          ))}
        </div>
      </section>

      <section>
        <p className="text-[12px] uppercase tracking-[0.06em] text-[#a1a1aa]">Color palette</p>
        {overview.palette.length ? (
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {overview.palette.map((swatch) => (
              <li
                key={`${swatch.name}:${swatch.value}`}
                className="flex items-center gap-2 rounded-lg border border-[#ececee] px-2 py-2"
              >
                <span
                  className="size-8 shrink-0 rounded-md border border-black/10"
                  style={{ background: swatch.value }}
                  title={swatch.value}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium capitalize text-[#16161a]">
                    {swatch.name}
                  </span>
                  <span className="block truncate font-mono text-[13px] text-[#71717a]">
                    {swatch.value}
                  </span>
                  <span className="block text-[13px] text-[#a1a1aa]">{swatch.usage}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2">No theme colors or color utilities were declared.</p>
        )}
      </section>

      <section>
        <p className="text-[12px] uppercase tracking-[0.06em] text-[#a1a1aa]">Button design</p>
        {overview.buttons.length ? (
          <ButtonGallery
            buttons={overview.buttons}
            stage={
              overview.palette.find((swatch) => swatch.usage === "Background")?.value ??
              overview.palette.find((swatch) => /background|bg/i.test(swatch.name))?.value ??
              "#111111"
            }
          />
        ) : (
          <p className="mt-2">No buttons were found to sample a design from.</p>
        )}
      </section>
    </div>
  );
}

function FontRow({ font }: { font: InspectFontRole }) {
  return (
    <div className="rounded-lg border border-[#ececee] px-3 py-2.5">
      <p className="text-[12px] uppercase tracking-[0.06em] text-[#a1a1aa]">{font.role}</p>
      <p
        className="mt-1 flex items-baseline justify-between gap-3 text-[20px] leading-7 text-[#16161a]"
        style={{
          fontFamily: fontStack(font.family),
          fontWeight: fontWeightValue(font.weight),
        }}
      >
        <span>{font.family}</span>
        <span className="shrink-0 text-[16px] font-normal text-[#52525b]">{font.size}</span>
      </p>
      <p className="mt-1 text-[15px]">{font.usage}</p>
    </div>
  );
}

function previewButtonClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter((cls) => {
      if (!cls) return false;
      if (/\b(absolute|fixed|sticky|inset-|top-|left-|right-|bottom-|z-|hidden|lg:hidden|sm:hidden|md:hidden|w-full|flex-1|min-w-0)\b/.test(cls)) {
        return false;
      }
      const base = cls.replace(/^(?:[\w-]+:)+/, "");
      return /^(inline-flex|flex|items-|justify-|gap-|rounded|bg-|text-|border|border-|px-|py-|p-|pt-|pr-|pb-|pl-|w-10|h-10|w-12|h-12|w-8|h-8|font-|tracking-|shadow|backdrop|outline|transition|hover:|focus:)/.test(
        base,
      ) || /^(hover|focus):(bg-|text-|border-|ring-|opacity)/.test(cls);
    })
    .join(" ");
}

function sampleButtonLabel(button: InspectButtonStyle): string {
  const name = button.example.replace(/\s+button$/i, "").trim();
  if (/hero wave|icon/i.test(name) && /icon/i.test(button.padding)) return "Go";
  if (name && !/^hero wave$/i.test(name)) return name;
  if (button.role === "primary") return "Search";
  if (button.role === "secondary") return "Chat";
  return "Sign out";
}

function buttonTextColor(button: InspectButtonStyle): string {
  if (button.text === "inherit") return "#16161a";
  if (button.text.startsWith("#")) return button.text;
  if (/white/i.test(button.text)) {
    const pct = /\/\s*(\d+)/.exec(button.text)?.[1];
    return pct ? `rgba(255,255,255,${Number(pct) / 100})` : "#ffffff";
  }
  if (/black/i.test(button.text)) return "#111111";
  return "#16161a";
}

function stageIsDark(stage: string): boolean {
  const hex = stage.match(/#([0-9a-f]{6})/i)?.[1];
  if (!hex) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

function ButtonGallery({
  buttons,
  stage,
}: {
  buttons: InspectButtonStyle[];
  stage: string;
}) {
  const dark = stageIsDark(stage);
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[#ececee]">
      <div
        className="flex flex-wrap items-end justify-center gap-10 px-6 py-10"
        style={{ background: stage }}
      >
        {buttons.map((button) => {
          const icon = /icon/i.test(button.padding);
          const classes = previewButtonClasses(button.className);
          return (
            <div key={button.role} className="flex flex-col items-center gap-3">
              <button
                type="button"
                tabIndex={-1}
                aria-label={sampleButtonLabel(button)}
                className={
                  classes ||
                  `inline-flex items-center justify-center ${icon ? "h-10 w-10" : "px-3 py-1.5 text-[14px] font-medium"} ${
                    button.radius === "pill"
                      ? "rounded-full"
                      : button.radius.includes("2xl")
                        ? "rounded-2xl"
                        : button.radius.includes("xl")
                          ? "rounded-xl"
                          : button.radius.includes("lg")
                            ? "rounded-lg"
                            : "rounded-md"
                  }`
                }
                style={
                  classes
                    ? undefined
                    : {
                        background:
                          button.fill === "ghost" || button.fill === "outline"
                            ? "transparent"
                            : button.fillCss,
                        color: buttonTextColor(button),
                        border:
                          button.fill === "outline" ? "1px solid rgba(255,255,255,0.2)" : undefined,
                      }
                }
              >
                {icon ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden
                  >
                    <path d="M7 17L17 7" />
                    <path d="M7 7h10v10" />
                  </svg>
                ) : (
                  sampleButtonLabel(button)
                )}
              </button>
              <p
                className="text-[13px] uppercase tracking-[0.06em]"
                style={{ color: dark ? "rgba(255,255,255,0.5)" : "#71717a" }}
              >
                {button.role}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TargetPanel({
  target,
  panel,
  action,
  report,
  width,
  onOpenPage,
}: {
  target: VibeInspectTarget;
  panel: Panel;
  action: Action;
  report: VibeInspectReport | null;
  width: Width;
  onOpenPage: (route: string) => void;
}) {
  const missing = missingStates(target);
  const usedOn = (target.how.usedOn.length ? target.how.usedOn : [target.route]).map(
    (route) => ({ route, name: pageNameOf(report, route) }),
  );
  const usedLabel = usedOn.map((item) => item.name).join(" and ");

  return (
    <div className="space-y-4 text-[16px] leading-relaxed text-[#3f3f46]">
      {panel === "what" ? (
        <>
          <p>{target.what.summary}</p>
          <Fact
            label="Data"
            value={`${originLabel(target.what.origin)}. ${target.what.originDetail}`}
          />
          <Fact
            label="Content"
            value={target.what.content}
          />
          <Fact
            label="Styles"
            value={
              target.what.styles.length
                ? target.what.styles.join(", ")
                : "No utility classes on this node."
            }
          />
          <Fact label="File" value={`${target.file}:${target.startLine}`} />
          <Fact label="Used on" value={usedLabel || "This page"} />
          {missing.length ? (
            <Fact label="Missing" value={missing.join(", ")} />
          ) : null}
          <Fact label="Next step" value={target.nextStep} />
        </>
      ) : null}

      {panel === "how" ? (
        <>
          <Fact
            label="Action"
            value={`${actionLabel(target.how.action)}. ${target.how.actionDetail}`}
          />
          <div>
            <p className="text-[#71717a]">Used on</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {usedOn.map((item) => (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => onOpenPage(item.route)}
                  className="rounded-full bg-[#f4f4f6] px-2 py-0.5 text-[12px] text-[#16161a]"
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
          {usedOn.length > 1 ? (
            <p>
              This is a shared component. A visual change here shows up on{" "}
              {usedLabel}.
            </p>
          ) : (
            <p>This file is only used on this page, so an edit stays local.</p>
          )}
          {width !== "desktop" ? (
            <p>
              You are looking at {width} width. If a label clips or a row refuses to
              wrap, the cause is usually a fixed width or overflow-hidden — those
              show up under Needs attention.
            </p>
          ) : null}
        </>
      ) : null}

      {panel === "attention" ? (
        target.attention.length ? (
          <ul className="space-y-3">
            {target.attention.map((note) => (
              <NoteBlock key={note.id} note={note} />
            ))}
          </ul>
        ) : (
          <p>Nothing stands out on this piece from the source we have.</p>
        )
      ) : null}

      {action === "source" ? (
        <pre className="overflow-auto rounded-lg bg-[#111] p-3 text-[11px] leading-5 text-[#e4e4e7]">
          {target.snippet || "No snippet."}
        </pre>
      ) : null}
      {action === "states" ? (
        <div>
          <p className="text-[#71717a]">States in this file</p>
          <ul className="mt-2 space-y-1">
            {Object.entries(target.how.states).map(([name, on]) => (
              <li key={name}>
                {on ? "Present" : "Missing"} — {name}
              </li>
            ))}
          </ul>
          {missing.length ? (
            <p className="mt-2">
              Missing: {missing.join(", ")}. People only see the happy path unless
              you add those.
            </p>
          ) : (
            <p className="mt-2">This file already names loading, empty, and error paths.</p>
          )}
        </div>
      ) : null}
      {action === "fix" ? (
        <p>
          {target.nextStep} Start from {target.file}:{target.startLine}.
        </p>
      ) : null}
    </div>
  );
}

function PageBrief({
  page,
  file,
  panel,
  targets,
  notes,
  reuse,
  report,
  route,
  width,
  onPick,
  onOpenPage,
}: {
  page: string;
  file: string;
  panel: Panel;
  targets: VibeInspectTarget[];
  notes: Array<{ note: InspectNote; target: VibeInspectTarget }>;
  reuse: InspectReuse[];
  report: VibeInspectReport | null;
  route: string;
  width: Width;
  onPick: (id: string) => void;
  onOpenPage: (route: string) => void;
}) {
  const origins = countBy(targets.map((target) => originLabel(target.what.origin)));
  const actions = countBy(targets.map((target) => actionLabel(target.how.action)));
  const dead = targets.filter(
    (target) => target.kind === "button" && target.how.action === "none",
  );
  const { shared, only, looks } = reuseOnRoute(reuse, route);

  return (
    <div className="space-y-4 text-[16px] leading-relaxed text-[#3f3f46]">
      {panel === "what" ? (
        <>
          <p>
            {page} is rendered from {file || "this page file"}. It has {targets.length}{" "}
            inspectable pieces. Click one on the canvas to see its component, styles,
            and content source.
          </p>
          {width !== "desktop" ? (
            <p>
              Same screen at {width} width. Watch for clipped labels, rows that will
              not wrap, and controls that become hard to tap.
            </p>
          ) : null}
          <Fact label="On this screen" value={summarizeCounts(origins)} />
          {targets.slice(0, 8).length ? (
            <ul className="space-y-1">
              {targets.slice(0, 8).map((target) => (
                <li key={target.id}>
                  <button
                    type="button"
                    onClick={() => onPick(target.id)}
                    className="w-full rounded-lg px-1 py-1 text-left hover:bg-[#fafafa]"
                  >
                    <span className="text-[#16161a]">{target.name}</span>
                    <span className="ml-2 text-[14px] text-[#71717a]">{target.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nothing on this page is inspectable yet.</p>
          )}
        </>
      ) : null}

      {panel === "how" ? (
        <>
          {shared.length ? (
            <ReuseList
              label="Also on other pages"
              items={shared}
              route={route}
              report={report}
              onOpenPage={onOpenPage}
            />
          ) : (
            <p>No component on this screen is reused on another page.</p>
          )}
          {only.length ? (
            <ReuseList
              label="Only on this page"
              items={only}
              route={route}
              report={report}
              onOpenPage={onOpenPage}
            />
          ) : null}
          {looks.length ? (
            <div>
              <p className="text-[#71717a]">Same look elsewhere</p>
              <ul className="mt-1 space-y-2">
                {looks.slice(0, 6).map((item) => {
                  const color = item.name.match(/#(?:[0-9a-f]{3,8})|rgba?\([^)]+\)/i)?.[0];
                  const others = item.routes.filter((itemRoute) => itemRoute !== route);
                  return (
                    <li key={item.name}>
                      <p className="flex items-center gap-2 text-[#16161a]">
                        {color ? (
                          <span
                            className="inline-block h-3.5 w-3.5 rounded-sm border border-black/10"
                            style={{ background: color }}
                          />
                        ) : null}
                        {item.name}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {others.map((itemRoute) => (
                          <button
                            key={itemRoute}
                            type="button"
                            onClick={() => onOpenPage(itemRoute)}
                            className="rounded-full bg-[#f4f4f6] px-2 py-0.5 text-[12px] text-[#16161a]"
                          >
                            {pageNameOf(report, itemRoute)}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <Fact label="Actions" value={summarizeCounts(actions)} />
          {dead.length ? (
            <Fact
              label="No behavior"
              value={dead.map((target) => target.name).join(", ")}
            />
          ) : null}
        </>
      ) : null}

      {panel === "attention" ? (
        <>
          <Fact
            label="Last AI change"
            value="No earlier snapshot is stored, so we cannot show a visual diff yet. Inspect this screen after the next edit."
          />
          {notes.length ? (
            <ul className="space-y-3">
              {notes.slice(0, 8).map((item) => (
                <li key={item.note.id}>
                  <button
                    type="button"
                    onClick={() => onPick(item.target.id)}
                    className="w-full rounded-lg text-left hover:bg-[#fafafa]"
                  >
                    <p className="font-medium text-[#16161a]">{item.note.title}</p>
                    <p className="mt-1">{item.note.detail}</p>
                    <p className="mt-1 text-[12px] text-[#71717a]">{item.target.name}</p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nothing stands out on this screen from the source we have.</p>
          )}
        </>
      ) : null}
    </div>
  );
}

function countBy(values: string[]): Array<{ label: string; count: number }> {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count }));
}

function summarizeCounts(rows: Array<{ label: string; count: number }>): string {
  if (!rows.length) return "Nothing mapped yet.";
  return rows.map((row) => `${row.count} ${row.label.toLowerCase()}`).join(" · ");
}

function ReuseList({
  label,
  items,
  route,
  report,
  onOpenPage,
}: {
  label: string;
  items: InspectReuse[];
  route: string;
  report: VibeInspectReport | null;
  onOpenPage: (route: string) => void;
}) {
  return (
    <div>
      <p className="text-[#71717a]">{label}</p>
      <ul className="mt-1 space-y-2">
        {items.slice(0, 8).map((item) => {
          const others = item.routes.filter((itemRoute) => itemRoute !== route);
          return (
            <li key={item.file ?? item.name}>
              <p className="text-[#16161a]">{item.name}</p>
              {item.file ? (
                <p className="text-[13px] text-[#71717a]">{item.file}</p>
              ) : null}
              {others.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {others.map((itemRoute) => (
                    <button
                      key={itemRoute}
                      type="button"
                      onClick={() => onOpenPage(itemRoute)}
                      className="rounded-full bg-[#f4f4f6] px-2 py-0.5 text-[12px] text-[#16161a]"
                    >
                      {pageNameOf(report, itemRoute)}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-[#71717a]">{label}. </span>
      {value}
    </p>
  );
}

function NoteBlock({ note }: { note: InspectNote }) {
  return (
    <li>
      <p className="text-[11px] uppercase tracking-[0.06em] text-[#a1a1aa]">{note.area}</p>
      <p className="mt-0.5 font-medium text-[#16161a]">{note.title}</p>
      <p className="mt-1">{note.detail}</p>
      <p className="mt-1 text-[#71717a]">{note.next}</p>
    </li>
  );
}
