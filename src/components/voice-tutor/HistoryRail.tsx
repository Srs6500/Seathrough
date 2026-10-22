"use client";

import { MessageSquare, Trash2 } from "lucide-react";
import type { HistorySession } from "@/lib/voice-tutor/sessionTypes";
import { cn } from "@/lib/utils";

type HistoryRailProps = {
  sessions: HistorySession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
};

export function HistoryRail({
  sessions,
  activeId,
  onSelect,
  onDelete,
  onNew,
}: HistoryRailProps) {
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col border-r border-board-edge bg-[#f4f8fb]"
      aria-label="Voice lesson history"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-muted">History</p>
          <h2 className="mt-0.5 font-[family-name:var(--font-newsreader)] text-[1.1rem] tracking-tight text-ink">
            Conversations
          </h2>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="rounded-lg border border-board-edge bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-accent-soft"
        >
          New
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {sessions.length === 0 ? (
          <p className="px-2 py-3 text-[13px] leading-5 text-muted">
            Finished voice lessons show up here with topic labels.
          </p>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeId;
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex items-start gap-2 rounded-xl px-2.5 py-2.5",
                  active ? "bg-accent-soft" : "hover:bg-white/80",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <MessageSquare className="size-3.5 shrink-0 text-accent" />
                    <span className="truncate">{session.label || session.topic}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {new Date(session.updatedAt).toLocaleString()}
                    {session.ended ? " · ended" : " · in progress"}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={() => onDelete(session.id)}
                  className="rounded-md p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-white hover:text-error"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
