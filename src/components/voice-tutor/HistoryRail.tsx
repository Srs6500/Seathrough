"use client";

import { MessageSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type HistoryRailItem = {
  id: string;
  label: string;
  topic?: string;
  updatedAt: number;
  ended?: boolean;
};

type HistoryRailProps = {
  sessions: HistoryRailItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  ariaLabel?: string;
  listTitle?: string;
  emptyText?: string;
  deleteLabel?: string;
};

export function HistoryRail({
  sessions,
  activeId,
  onSelect,
  onDelete,
  onNew,
  ariaLabel = "Voice lesson history",
  listTitle = "Conversations",
  emptyText = "Finished voice lessons show up here with topic labels.",
  deleteLabel = "Delete conversation",
}: HistoryRailProps) {
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col border-r border-[#ececee] bg-white"
      aria-label={ariaLabel}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#f0f0f3] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] text-[#71717a]">History</p>
          <h2 className="mt-0.5 text-[15px] text-[#16161a]">{listTitle}</h2>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="h-8 rounded-lg border border-[#ececee] bg-white px-2.5 text-[12px] font-medium text-[#16161a] hover:bg-[#fafafa]"
        >
          New
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-3 text-[13px] leading-5 text-[#71717a]">
            {emptyText}
          </p>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeId;
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex items-start gap-2 rounded-lg px-2.5 py-2",
                  active ? "bg-[#f4f1ff]" : "hover:bg-[#fafafa]",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-[13px] font-medium",
                      active ? "text-[#5b4fd4]" : "text-[#16161a]",
                    )}
                  >
                    <MessageSquare className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {session.label || session.topic}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#71717a]">
                    {new Date(session.updatedAt).toLocaleString()}
                    {session.ended ? " · ended" : " · in progress"}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={deleteLabel}
                  onClick={() => onDelete(session.id)}
                  className="rounded-md p-1 text-[#71717a] opacity-0 transition group-hover:opacity-100 hover:bg-white hover:text-[#c24545]"
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
