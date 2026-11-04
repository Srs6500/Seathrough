"use client";

import { useState } from "react";
import { LogIn, LogOut, Ticket } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  /** Name from tutor settings; preferred over the username for display. */
  displayName?: string;
  className?: string;
};

function initials(name: string) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Header profile: avatar + card when signed in, "Log in" chip when not. */
export function ProfileMenu({ displayName, className }: Props) {
  const { user, loading, logout } = useAuth();
  const { billing, openAuth, openPromo } = useQuestionAccess();
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <span
        aria-hidden
        className={cn("size-9 animate-pulse rounded-full border border-[#ececee] bg-white", className)}
      />
    );
  }

  const tutorUsage = billing?.usage["smart-tutor"];
  const limit = tutorUsage?.limit ?? 5;
  const left = Math.max(0, limit - (tutorUsage?.used ?? 0));
  const isPro = billing?.plan === "pro";

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => openAuth("signup")}
        title={`${left} of ${limit} free Smart tutor conversations left`}
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[#ececee] bg-white px-3 text-[13px] font-medium text-[#16161a] transition hover:bg-[#fafafa]",
          className,
        )}
      >
        <LogIn className="size-3.5" />
        Log in
        <span className="rounded-full bg-[#f4f4f6] px-1.5 py-0.5 text-[11px] font-medium text-[#71717a]">
          {left}/{limit}
        </span>
      </button>
    );
  }

  const name = displayName?.trim() || user.username;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Profile: ${name}`}
          title={name}
          className={cn(
            "grid size-9 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#9fd0ff_0%,#1b6ca8_60%,#0d3f6b_100%)] text-[12px] font-semibold text-white shadow-[0_2px_6px_rgba(27,108,168,0.3)] ring-2 ring-white transition hover:brightness-110 focus-visible:ring-[#1b6ca8]/50 focus-visible:outline-none",
            className,
          )}
        >
          {initials(name)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 border border-[#ececee] bg-white p-0 text-[#16161a] shadow-[0_12px_32px_rgba(22,22,26,0.12)] ring-0"
      >
        <div className="flex items-center gap-3 border-b border-[#ececee] p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#9fd0ff_0%,#1b6ca8_60%,#0d3f6b_100%)] text-[13px] font-semibold text-white">
            {initials(name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold tracking-[-0.01em]">{name}</p>
            <p className="truncate text-[12px] text-[#71717a]">@{user.username}</p>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-[12px]">
          <span className="text-[#71717a]">Plan</span>
          {isPro ? (
            <span className="rounded-full bg-[#eef5fb] px-2 py-0.5 font-medium text-[#1b6ca8]">Unlimited</span>
          ) : (
            <span className="rounded-full bg-[#f4f4f6] px-2 py-0.5 font-medium text-[#3f3f46]">
              Free · {left}/{limit} left
            </span>
          )}
        </div>
        <div className="border-t border-[#ececee] p-1.5">
          {!isPro ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openPromo();
              }}
              className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-[#1b6ca8] transition hover:bg-[#f4f4f6]"
            >
              <Ticket className="size-3.5" />
              Redeem promo code
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-[#16161a] transition hover:bg-[#f4f4f6]"
          >
            <LogOut className="size-3.5" />
            Log out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
