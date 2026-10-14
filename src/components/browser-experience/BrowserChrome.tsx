"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  Lock,
  Menu,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import type { BrowserTabPublic } from "@/lib/browser-experience/types";
import { hostnameLabel } from "@/lib/browser-experience/tabs";
import { cn } from "@/lib/utils";

export type BrowserPaneInput = {
  type: "click" | "dblclick" | "type" | "key";
  xNorm?: number;
  yNorm?: number;
  text?: string;
  key?: string;
};

type BrowserChromeProps = {
  addressBar: string;
  liveViewUrl: string | null;
  frameDataUrl: string | null;
  frameStream: boolean;
  interactive?: boolean;
  /** Local provider — interact via click relay on the screenshot. */
  localDesktop?: boolean;
  statusLabel: string;
  className?: string;
  onPaneInput?: (input: BrowserPaneInput) => void;
  /** Muse-style multi-tab strip. */
  tabs?: BrowserTabPublic[];
  activeTabId?: string | null;
  /**
   * When false (agent driving), tabs are display-only.
   * Manual switch / close / + only while Take control is on.
   */
  tabsInteractive?: boolean;
  onActivateTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onNewTab?: () => void;
  /** Muse omnibox — URL or Google search query. */
  onNavigate?: (query: string) => void;
  onReload?: () => void;
};

/**
 * Map a pointer event onto the visible frame image.
 * Matches CSS object-contain + object-top (top-aligned, horizontally centered).
 */
function mapClickToNorm(
  clientX: number,
  clientY: number,
  container: DOMRect,
  natW: number,
  natH: number,
): { xNorm: number; yNorm: number } | null {
  if (natW < 1 || natH < 1) return null;
  const scale = Math.min(container.width / natW, container.height / natH);
  const dispW = natW * scale;
  const dispH = natH * scale;
  const ox = container.left + (container.width - dispW) / 2;
  const oy = container.top; // object-top
  const x = (clientX - ox) / dispW;
  const y = (clientY - oy) / dispH;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { xNorm: x, yNorm: y };
}

function TabFavicon({ tab }: { tab: BrowserTabPublic }) {
  if (tab.faviconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={tab.faviconUrl}
        alt=""
        width={14}
        height={14}
        className="size-3.5 shrink-0 rounded-[2px]"
        draggable={false}
      />
    );
  }
  return <Globe2 className="size-3.5 shrink-0 text-[#6b7c8d]" />;
}

export function BrowserChrome({
  addressBar,
  liveViewUrl,
  frameDataUrl,
  frameStream,
  interactive = false,
  localDesktop = false,
  statusLabel,
  className,
  onPaneInput,
  tabs = [],
  activeTabId = null,
  tabsInteractive = false,
  onActivateTab,
  onCloseTab,
  onNewTab,
  onNavigate,
  onReload,
}: BrowserChromeProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [omnibox, setOmnibox] = useState(addressBar || "");
  const omniboxFocusedRef = useRef(false);

  useEffect(() => {
    if (omniboxFocusedRef.current) return;
    setOmnibox(addressBar || "");
  }, [addressBar, activeTabId]);

  const showLive =
    Boolean(liveViewUrl) && !localDesktop && (interactive || !frameStream);
  const showFrameMirror =
    !showLive &&
    Boolean(frameDataUrl) &&
    (frameStream || localDesktop || interactive);
  // Relay whenever Take control is on and we have a frame (or will shortly).
  const relayClicks = interactive && Boolean(onPaneInput) && !showLive;

  const visibleTabs =
    tabs.length > 0
      ? tabs
      : [
          {
            id: "placeholder",
            title: "New Tab",
            url: addressBar || "about:blank",
            faviconUrl: null,
            kind: "blank" as const,
            role: null,
          },
        ];
  const activeId = activeTabId || visibleTabs[0]?.id || null;
  const host = hostnameLabel(addressBar || "about:blank");

  useEffect(() => {
    if (!interactive || !showLive) return;
    iframeRef.current?.focus();
  }, [interactive, showLive, liveViewUrl]);

  useEffect(() => {
    if (!relayClicks) return;
    paneRef.current?.focus();
  }, [relayClicks, showFrameMirror]);

  useEffect(() => {
    if (!relayClicks || !onPaneInput) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Don't steal keys from the prompt bar / buttons.
      if (target?.closest("form, [role='dialog'], header")) return;

      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        onPaneInput({ type: "type", text: event.key });
        return;
      }
      const map: Record<string, string> = {
        Enter: "Enter",
        Backspace: "Backspace",
        Tab: "Tab",
        Escape: "Escape",
        ArrowLeft: "ArrowLeft",
        ArrowRight: "ArrowRight",
        ArrowUp: "ArrowUp",
        ArrowDown: "ArrowDown",
      };
      const key = map[event.key];
      if (key) {
        event.preventDefault();
        onPaneInput({ type: "key", key });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [relayClicks, onPaneInput]);

  function handlePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!relayClicks || !onPaneInput) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const pane = paneRef.current;
    const img = imgRef.current;
    if (!pane) return;
    const container = pane.getBoundingClientRect();
    const natW = img?.naturalWidth || 1280;
    const natH = img?.naturalHeight || 800;
    const mapped = mapClickToNorm(
      event.clientX,
      event.clientY,
      container,
      natW,
      natH,
    );
    if (!mapped) return;
    onPaneInput({
      type: event.detail >= 2 ? "dblclick" : "click",
      ...mapped,
    });
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#c5cdd6] bg-[#dee3e9] shadow-[0_20px_50px_rgba(15,35,55,0.14)]",
        className,
      )}
    >
      {/* Muse-style tab strip — clickable only while Take control is on */}
      <div className="flex min-h-9 items-end gap-0.5 border-b border-[#c5cdd6] bg-[#cfd6de] px-2 pt-1.5">
        <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
          {visibleTabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "group relative flex h-8 max-w-[220px] min-w-[120px] items-center gap-1.5 px-2.5 text-[12px]",
                  active
                    ? "rounded-t-lg bg-white text-[#1a2430] shadow-[0_-1px_0_rgba(255,255,255,0.8)]"
                    : "rounded-t-lg bg-transparent text-[#3d4d5c]",
                  tabsInteractive && !active && "hover:bg-[#e4e9ef]/70",
                  !tabsInteractive && "cursor-default",
                )}
              >
                <button
                  type="button"
                  disabled={!tabsInteractive || tab.id === "placeholder"}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 text-left",
                    !tabsInteractive && "cursor-default",
                  )}
                  onClick={() => {
                    if (!tabsInteractive || tab.id === "placeholder") return;
                    onActivateTab?.(tab.id);
                  }}
                  title={
                    tabsInteractive
                      ? tab.title
                      : `${tab.title} (Take control to switch tabs)`
                  }
                >
                  <TabFavicon tab={tab} />
                  <span className="truncate font-medium tracking-tight">
                    {tab.title || "New Tab"}
                  </span>
                </button>
                {tabsInteractive &&
                tabs.length > 1 &&
                tab.id !== "placeholder" ? (
                  <button
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full text-[#6b7c8d]",
                      "opacity-0 hover:bg-[#e8eef3] hover:text-[#1a2430] group-hover:opacity-100",
                      active && "opacity-70",
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab?.(tab.id);
                    }}
                  >
                    <X className="size-3" strokeWidth={2.25} />
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            aria-label="New tab"
            className={cn(
              "mb-0.5 ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[#4a5c6c]",
              tabsInteractive
                ? "hover:bg-[#e4e9ef]"
                : "cursor-default opacity-40",
            )}
            onClick={() => {
              if (!tabsInteractive) return;
              onNewTab?.();
            }}
            disabled={!tabsInteractive || !onNewTab}
            title={
              tabsInteractive
                ? "New tab"
                : "Take control to open a new tab"
            }
          >
            <Plus className="size-3.5" strokeWidth={2.25} />
          </button>
        </div>
      </div>

      {/* Nav + Muse-style omnibox (search or URL while Take control) */}
      <div className="flex items-center gap-2 border-b border-[#d5dde6] bg-white px-2.5 py-1.5">
        <div className="flex items-center gap-0.5 text-[#5b6b7a]">
          <span className="flex size-7 items-center justify-center rounded-full opacity-45">
            <ArrowLeft className="size-3.5" />
          </span>
          <span className="flex size-7 items-center justify-center rounded-full opacity-45">
            <ArrowRight className="size-3.5" />
          </span>
          <button
            type="button"
            aria-label="Reload"
            disabled={!tabsInteractive || !onReload}
            className={cn(
              "flex size-7 items-center justify-center rounded-full",
              tabsInteractive
                ? "hover:bg-[#eef2f6] text-[#5b6b7a]"
                : "opacity-45 cursor-default",
            )}
            onClick={() => {
              if (!tabsInteractive) return;
              onReload?.();
            }}
          >
            <RotateCw className="size-3.5" />
          </button>
        </div>
        <div className="hidden items-center sm:flex">
          <span className="rounded-full bg-[#eef2f6] px-2.5 py-1 text-[11px] font-medium text-[#5b6b7a]">
            {host}
          </span>
        </div>
        <form
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-[#eef2f6] px-3 py-1.5 text-[12px] text-[#1a2430]"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!tabsInteractive || !onNavigate) return;
            const next = omnibox.trim();
            if (!next) return;
            onNavigate(next);
            omniboxFocusedRef.current = false;
          }}
        >
          <Lock className="size-3.5 shrink-0 text-[#7a8b9a]" />
          {tabsInteractive && onNavigate ? (
            <input
              type="text"
              value={omnibox}
              onChange={(event) => setOmnibox(event.target.value)}
              onFocus={() => {
                omniboxFocusedRef.current = true;
              }}
              onBlur={() => {
                omniboxFocusedRef.current = false;
                setOmnibox(addressBar || "");
              }}
              placeholder="Search Google or type a URL"
              className="min-w-0 flex-1 bg-transparent font-medium tracking-tight outline-none placeholder:text-[#8a9aab]"
              spellCheck={false}
              autoComplete="off"
            />
          ) : (
            <span className="truncate font-medium tracking-tight">
              {addressBar || "about:blank"}
            </span>
          )}
        </form>
        <span className="flex size-7 items-center justify-center rounded-full text-[#5b6b7a] opacity-60">
          <Menu className="size-3.5" />
        </span>
      </div>

      {/* No in-chrome banner — ControlBanner above owns Take/Resume copy so the
          viewport height stays stable when interactive flips on. */}
      <div
        ref={paneRef}
        tabIndex={relayClicks ? 0 : undefined}
        className={cn(
          "relative min-h-0 flex-1 bg-[#0b1220] outline-none",
          relayClicks && "cursor-pointer",
          interactive && "ring-1 ring-inset ring-amber-400/40",
        )}
      >
        {showLive ? (
          <iframe
            ref={iframeRef}
            key={liveViewUrl!}
            title="Live browser"
            src={liveViewUrl!}
            className="pointer-events-auto absolute inset-0 h-full w-full border-0 bg-white"
            allow="clipboard-read; clipboard-write; fullscreen; autoplay"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            onClick={() => iframeRef.current?.focus()}
          />
        ) : showFrameMirror ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={frameDataUrl!}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain object-top bg-white"
            onDragStart={(event) => event.preventDefault()}
          />
        ) : interactive ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-[#9fb3c4]">
            <Globe2 className="size-10 opacity-50" />
            <p className="max-w-sm text-sm leading-relaxed">
              Loading the live view… if blank, wait a moment or click Take control again.
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-[#9fb3c4]">
            <Globe2 className="size-10 opacity-50" />
            <p className="max-w-sm text-sm leading-relaxed">{statusLabel}</p>
          </div>
        )}

        {/* Hit layer above the frame — clicks map to Playwright (img is view-only). */}
        {relayClicks ? (
          <div
            className="absolute inset-0 z-10 cursor-pointer touch-none"
            aria-label="Interactive browser surface"
            onPointerDown={handlePointer}
          />
        ) : null}
      </div>
    </div>
  );
}
