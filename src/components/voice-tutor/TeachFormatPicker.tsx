"use client";

import { useSyncExternalStore } from "react";
import { Check, FileText, Presentation, Shapes, Video } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How the tutor teaches: any mix of written text, diagrams, and a video.
 * Whiteboard is a full board lesson, so it replaces text + diagram while on.
 */
export type TeachFormats = {
  text: boolean;
  diagram: boolean;
  video: boolean;
  whiteboard: boolean;
};

export const DEFAULT_TEACH_FORMATS: TeachFormats = {
  text: true,
  diagram: true,
  video: false,
  whiteboard: false,
};

function anyFormat(f: TeachFormats): boolean {
  return f.text || f.diagram || f.video || f.whiteboard;
}

/** Apply a toggle, keeping whiteboard and text/diagram mutually exclusive. */
export function toggleTeachFormat(value: TeachFormats, key: keyof TeachFormats): TeachFormats {
  const on = !value[key];
  if (key === "whiteboard" && on) return { ...value, whiteboard: true, text: false, diagram: false };
  if ((key === "text" || key === "diagram") && on) return { ...value, [key]: true, whiteboard: false };
  return { ...value, [key]: on };
}

const STORAGE_KEY = "seethrough.voice-tutor.formats";

function loadTeachFormats(): TeachFormats {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<TeachFormats>
      | null;
    if (!raw) return DEFAULT_TEACH_FORMATS;
    const next = {
      text: raw.text === true,
      diagram: raw.diagram === true,
      video: raw.video === true,
      whiteboard: raw.whiteboard === true,
    };
    if (next.whiteboard) {
      next.text = false;
      next.diagram = false;
    }
    return anyFormat(next) ? next : DEFAULT_TEACH_FORMATS;
  } catch {
    return DEFAULT_TEACH_FORMATS;
  }
}

// Tiny external store: remembered per browser, SSR-safe (server = defaults).
let cached: TeachFormats | null = null;
const listeners = new Set<() => void>();

function snapshot(): TeachFormats {
  cached ??= loadTeachFormats();
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTeachFormats(formats: TeachFormats): void {
  cached = formats;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(formats));
  } catch {
    /* private mode — the choice just won't persist */
  }
  for (const listener of listeners) listener();
}

export function useTeachFormats(): TeachFormats {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_TEACH_FORMATS);
}

const OPTIONS = [
  { key: "text", label: "Text", Icon: FileText },
  { key: "diagram", label: "Diagram", Icon: Shapes },
  { key: "whiteboard", label: "Whiteboard", Icon: Presentation },
  { key: "video", label: "Video", Icon: Video },
] as const;

export function TeachFormatPicker({
  value,
  onChange,
  className,
}: {
  value: TeachFormats;
  onChange: (next: TeachFormats) => void;
  className?: string;
}) {
  const onCount = OPTIONS.filter((o) => value[o.key]).length;
  return (
    <fieldset className={cn("flex flex-wrap items-center justify-center gap-1.5", className)}>
      <legend className="sr-only">Teach with</legend>
      <span className="mr-1 text-[12px] text-[#71717a]" aria-hidden>
        Teach with
      </span>
      {OPTIONS.map(({ key, label, Icon }) => {
        const checked = value[key];
        const locked = checked && onCount === 1;
        return (
          <label
            key={key}
            title={locked ? "Keep at least one way to learn" : undefined}
            className={cn(
              "inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#5b4fd4]/40",
              checked
                ? "border-[#16161a] bg-[#16161a] text-white"
                : "border-[#ececee] bg-white text-[#16161a] hover:bg-[#fafafa]",
              locked && "cursor-not-allowed",
            )}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={checked}
              disabled={locked}
              onChange={() => onChange(toggleTeachFormat(value, key))}
            />
            {checked ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Icon className="size-3.5" aria-hidden />
            )}
            {label}
          </label>
        );
      })}
    </fieldset>
  );
}
